"""Talking to an MQTT broker on the user's behalf.

Same reasoning as the HTTP and websocket clients: the browser cannot speak
MQTT at all unless the broker happens to expose it over websockets, and the
credentials would be readable by the page if it did. The server holds the
broker connection and relays over one websocket.

Two things that look like details and are not:

* **A subscribe is not done until the broker has acknowledged it.** Reporting
  "subscribed" when the packet was written means a publish sent straight
  afterwards can arrive before the broker has registered the subscription, and
  MQTT will simply drop it. This is the same failure as reporting a websocket
  "connected" before the upstream is up.
* **Every connection needs its own client id.** A broker evicts the existing
  session when a second one connects with the same id, so a shared id makes
  two tabs kick each other off in a loop.
"""

from __future__ import annotations

import asyncio
import base64
import json
import ssl
import uuid
from dataclasses import dataclass, field, replace
from typing import Any, Optional
from urllib.parse import parse_qs, unquote, urlparse

#: Brokers reject a client id longer than 23 characters in MQTT 3.1.
MAX_CLIENT_ID = 23

#: The conventional TLS port, where TLS should be on without being asked for.
TLS_PORT = 8883

DEFAULT_PORT = 1883
DEFAULT_KEEPALIVE = 60

#: How long to wait for CONNACK before giving up.
CONNECT_TIMEOUT = 15.0


@dataclass
class BrokerAddress:
    host: str
    port: int
    use_tls: bool
    username: Optional[str] = None
    password: Optional[str] = None
    #: A path prefix, for brokers reached over websockets.
    path: str = ""

    @property
    def display(self) -> str:
        scheme = "mqtts" if self.use_tls else "mqtt"
        return f"{scheme}://{self.host}:{self.port}{self.path}"


#: Protocol versions a connection can ask for. 5 is the default because user
#: properties and enhanced authentication only exist there; 3.1.1 is the
#: fallback for a broker that refuses a v5 CONNECT.
PROTOCOL_5 = "5"
PROTOCOL_311 = "3.1.1"
PROTOCOLS = (PROTOCOL_5, PROTOCOL_311)

#: A broker that does not speak MQTT 5 answers CONNACK with this.
UNSUPPORTED_PROTOCOL = 132


@dataclass
class BrokerOptions:
    """Everything about a session that is not the address.

    These live in the connection's variables rather than the URL: a URL is
    shown on every screen the connection appears on, and a credential in one
    is a credential on display.
    """

    protocol: str = PROTOCOL_5
    username: Optional[str] = None
    password: Optional[str] = None
    #: MQTT 5 enhanced authentication: a named method and its credential,
    #: which is how a broker takes a JWT or a session secret instead of a
    #: password.
    auth_method: Optional[str] = None
    auth_data: Optional[str] = None
    #: Sent on CONNECT. Brokers use these to route or authorise a session.
    user_properties: list[tuple[str, str]] = field(default_factory=list)
    client_id: Optional[str] = None
    verify_tls: bool = True
    #: A private CA, for a broker behind a certificate no public root chains to.
    ca_certs: Optional[str] = None
    clean_start: bool = True

    @property
    def speaks_v5(self) -> bool:
        return self.protocol == PROTOCOL_5

    def with_protocol(self, protocol: str) -> "BrokerOptions":
        return replace(self, protocol=protocol)


def pairs_from(value) -> list[tuple[str, str]]:
    """Read user properties out of whatever the connection stored.

    An object is the natural way to write them; a list of rows is what the
    request builder's key/value editor produces. Both are accepted, because
    MQTT allows the same name more than once and an object cannot.
    """
    if not value:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []

    if isinstance(value, dict):
        return [(str(key), str(item)) for key, item in value.items()]
    if isinstance(value, list):
        rows = []
        for row in value:
            if isinstance(row, dict):
                if row.get("enabled") is False:
                    continue
                key = str(row.get("key") or "").strip()
                if key:
                    rows.append((key, str(row.get("value") or "")))
            elif isinstance(row, (list, tuple)) and len(row) == 2:
                rows.append((str(row[0]), str(row[1])))
        return rows
    return []


def options_from(variables: dict, address: BrokerAddress) -> BrokerOptions:
    """Read the session's settings out of the connection's variables."""
    variables = variables or {}

    protocol = str(variables.get("mqtt_protocol") or PROTOCOL_5).strip()
    if protocol not in PROTOCOLS:
        protocol = PROTOCOL_5

    username, password = credentials(address, variables)
    return BrokerOptions(
        protocol=protocol,
        username=username,
        password=password,
        auth_method=str(variables.get("mqtt_auth_method") or "").strip() or None,
        auth_data=str(variables.get("mqtt_auth_data") or "").strip() or None,
        user_properties=pairs_from(variables.get("mqtt_user_properties")),
        client_id=str(variables.get("mqtt_client_id") or "").strip() or None,
        verify_tls=not is_true(variables.get("mqtt_tls_insecure")),
        ca_certs=str(variables.get("mqtt_ca_certs") or "").strip() or None,
        clean_start=not is_true(variables.get("mqtt_resume_session")),
    )


def is_true(value) -> bool:
    return str(value or "").strip().lower() in ("1", "true", "yes", "on")


def is_mqtt_url(url: str) -> bool:
    return str(url or "").strip().lower().startswith(("mqtt://", "mqtts://"))


def parse_broker_url(url: str) -> BrokerAddress:
    """Read a broker address out of `mqtt://user:pass@host:1883`.

    TLS is on for `mqtts://`, and also for the conventional TLS port, since a
    broker on 8883 that is asked for plaintext simply hangs up.
    """
    text = str(url or "").strip()
    if not is_mqtt_url(text):
        raise ValueError(
            f"'{text or 'The URL'}' is not a broker address. "
            "Use mqtt://host:1883 or mqtts://host:8883."
        )

    parsed = urlparse(text)
    if not parsed.hostname:
        raise ValueError(f"'{text}' has no host. Use mqtt://host:1883.")

    use_tls = parsed.scheme == "mqtts" or parsed.port == TLS_PORT
    port = parsed.port or (TLS_PORT if use_tls else DEFAULT_PORT)

    return BrokerAddress(
        host=parsed.hostname,
        port=port,
        use_tls=use_tls,
        username=unquote(parsed.username) if parsed.username else None,
        password=unquote(parsed.password) if parsed.password else None,
        path=parsed.path or "",
    )


def credentials(address: BrokerAddress, variables: dict) -> tuple[Optional[str], Optional[str]]:
    """Prefer the connection's variables over anything embedded in the URL.

    A password in a URL is visible in every place the URL is shown; the
    variables are stored masked, so they are the better home for it.
    """
    username = variables.get("mqtt_username") or address.username
    password = (
        variables.get("mqtt_password")
        or variables.get("mqtt_token")
        or address.password
    )
    return (str(username) if username else None, str(password) if password else None)


def client_id(prefix: str = "datapilot") -> str:
    """A unique id per connection, short enough for a 3.1 broker."""
    suffix = uuid.uuid4().hex
    room = MAX_CLIENT_ID - 1 - len(prefix)
    if room < 4:
        prefix = prefix[: MAX_CLIENT_ID - 5]
        room = 4
    return f"{prefix}-{suffix[:room]}"


def tls_context(
    address: BrokerAddress,
    verify: bool = True,
    ca_certs: Optional[str] = None,
) -> Optional[ssl.SSLContext]:
    """The TLS settings for a broker.

    A private CA is the usual case behind a gateway: the certificate is real
    but chains to a root no public trust store carries, so the choice is to
    name the root or to stop checking.
    """
    if not address.use_tls:
        return None
    context = ssl.create_default_context(cafile=ca_certs or None)
    if not verify:
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    return context


def valid_topic_filter(topic: str) -> Optional[str]:
    """Say what is wrong with a topic filter, or nothing if it is fine.

    A malformed filter is refused by the broker with a disconnect rather than
    an error, which reads as "it broke" instead of "that filter is invalid".
    """
    text = str(topic or "")
    if not text:
        return "A topic filter cannot be empty."
    if len(text.encode("utf-8")) > 65535:
        return "That topic filter is too long."
    if "\x00" in text:
        return "A topic filter cannot contain a null character."

    levels = text.split("/")
    for index, level in enumerate(levels):
        if "+" in level and level != "+":
            return (
                "'+' matches exactly one whole level, so it cannot sit next to "
                "other characters - use 'a/+/b', not 'a/x+/b'."
            )
        if "#" in level:
            if level != "#":
                return (
                    "'#' matches the rest of the topic, so it cannot sit next "
                    "to other characters - use 'a/#', not 'a/x#'."
                )
            if index != len(levels) - 1:
                return "'#' can only be the last level of a filter."
    return None


def valid_topic_name(topic: str) -> Optional[str]:
    """A topic published to is a name, not a filter: no wildcards allowed."""
    text = str(topic or "")
    if not text:
        return "A topic cannot be empty."
    if "+" in text or "#" in text:
        return (
            "Wildcards belong in a subscription, not in the topic you publish "
            "to. Publish to a concrete topic such as 'sensors/1/temperature'."
        )
    if "\x00" in text:
        return "A topic cannot contain a null character."
    return None


def normalise_qos(value) -> int:
    try:
        qos = int(value)
    except (TypeError, ValueError):
        return 0
    return qos if qos in (0, 1, 2) else 0


def describe_failure(address: BrokerAddress, error: Exception) -> str:
    """Say what went wrong reaching a broker, in words worth showing a person."""
    from .http_client import container_hint

    text = str(error).strip() or type(error).__name__
    lowered = text.lower()
    target = address.display

    if "not authorised" in lowered or "not authorized" in lowered or "bad user" in lowered:
        detail = (
            f"{target} refused the credentials. Set mqtt_username and "
            "mqtt_password in the connection's variables."
        )
    elif "refused" in lowered or "connection refused" in lowered:
        detail = (
            f"Could not reach {target}: the connection was refused. Nothing is "
            "listening on that host and port."
        )
    elif "name or service not known" in lowered or "getaddrinfo" in lowered:
        detail = f"Could not resolve the host in {target}. Check the hostname."
    elif "timed out" in lowered or "timeout" in lowered:
        detail = f"Timed out connecting to {target}."
    elif "ssl" in lowered or "certificate" in lowered:
        detail = (
            f"TLS failed talking to {target}: {text}. A broker on "
            f"{TLS_PORT} expects TLS; one on {DEFAULT_PORT} usually does not."
        )
    else:
        detail = f"Could not connect to {target}: {text}"

    return container_hint(f"{address.host}:{address.port}", detail)


class MqttError(Exception):
    """A broker failure already phrased for a person."""


@dataclass
class Incoming:
    topic: str
    payload: str
    is_text: bool
    qos: int
    retain: bool
    #: MQTT 5 carries metadata alongside the payload; a broker that routes on
    #: user properties is unusable without seeing them.
    user_properties: list[list[str]] = field(default_factory=list)
    content_type: Optional[str] = None
    response_topic: Optional[str] = None
    correlation_data: Optional[str] = None
    message_expiry: Optional[int] = None


class MqttSession:
    """One broker session, driven from asyncio.

    paho runs its own network thread and polls its own socket, which is why it
    is used directly rather than through an asyncio wrapper: the wrappers
    register the socket with the event loop, and Windows' default (proactor)
    loop cannot do that at all.

    Everything the browser can ask for waits for the broker's acknowledgement,
    so "subscribed" and "published" mean the broker agreed rather than that a
    packet was written.
    """

    #: How long to wait for a SUBACK, UNSUBACK or PUBACK.
    ACK_TIMEOUT = 10.0

    #: Messages held for the browser before the oldest is dropped.
    MAX_QUEUED = 1000

    def __init__(
        self,
        address: BrokerAddress,
        options: Optional[BrokerOptions] = None,
        *,
        identifier: Optional[str] = None,
    ):
        import paho.mqtt.client as paho

        self.address = address
        self.options = options or BrokerOptions()
        self.identifier = identifier or self.options.client_id or client_id()
        self.dropped = 0
        self.refused_protocol = False

        self._loop = asyncio.get_running_loop()
        self._messages: asyncio.Queue = asyncio.Queue(maxsize=self.MAX_QUEUED)
        self._pending: dict = {}
        self._connected: Optional[asyncio.Future] = None
        self._closed = False
        self._disconnect_reason: Optional[str] = None

        if self.options.speaks_v5:
            self._client = paho.Client(
                paho.CallbackAPIVersion.VERSION2,
                client_id=self.identifier,
                protocol=paho.MQTTv5,
                # a QoS 1 delivery is acknowledged once the browser has it, not
                # the moment it arrives here: the PUBACK is what tells the
                # broker it may stop replaying the message
                manual_ack=True,
            )
        else:
            self._client = paho.Client(
                paho.CallbackAPIVersion.VERSION2,
                client_id=self.identifier,
                protocol=paho.MQTTv311,
                clean_session=self.options.clean_start,
                manual_ack=True,
            )

        if self.options.username:
            self._client.username_pw_set(self.options.username, self.options.password)
        if address.use_tls:
            self._client.tls_set_context(
                tls_context(address, self.options.verify_tls, self.options.ca_certs)
            )
            if not self.options.verify_tls:
                self._client.tls_insecure_set(True)

        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message
        self._client.on_subscribe = self._on_ack("subscribe")
        self._client.on_unsubscribe = self._on_ack("unsubscribe")
        self._client.on_publish = self._on_ack("publish")

    def _settle(self, future, value, error=None):
        """Resolve a future from paho's network thread."""
        if future is None or future.done():
            return

        def apply():
            if future.done():
                return
            if error is not None:
                future.set_exception(error)
            else:
                future.set_result(value)

        self._loop.call_soon_threadsafe(apply)

    def _on_connect(self, _client, _userdata, _flags, reason_code, _properties=None):
        if is_success(reason_code):
            self._settle(self._connected, True)
            return

        # a broker that only speaks 3.1.1 says so here, and the caller retries
        # rather than showing "refused" for a version mismatch
        self.refused_protocol = reason_code_value(reason_code) == UNSUPPORTED_PROTOCOL
        self._settle(
            self._connected,
            None,
            MqttError(connect_refusal(self.address, reason_code, self.options)),
        )

    def _on_disconnect(
        self, _client, _userdata, _flags=None, reason_code=None, _properties=None
    ):
        if self._closed:
            return
        self._disconnect_reason = f"{self.address.display} closed the session"
        if reason_code is not None and not is_success(reason_code):
            self._disconnect_reason += f": {reason_code}"

        # wake anything waiting, so a dropped session is not a silent hang
        self._settle(self._connected, None, MqttError(self._disconnect_reason))
        for future in list(self._pending.values()):
            self._settle(future, None, MqttError(self._disconnect_reason))
        self._loop.call_soon_threadsafe(self._messages.put_nowait, None)

    def _on_message(self, client, _userdata, message):
        raw = message.payload or b""
        try:
            payload, is_text = raw.decode("utf-8"), True
        except UnicodeDecodeError:
            payload, is_text = base64.b64encode(raw).decode("ascii"), False

        incoming = Incoming(
            topic=str(message.topic),
            payload=payload,
            is_text=is_text,
            qos=int(message.qos),
            retain=bool(message.retain),
            **read_message_properties(getattr(message, "properties", None)),
        )

        def deliver():
            try:
                self._messages.put_nowait(incoming)
            except asyncio.QueueFull:
                # dropping the oldest keeps a firehose topic from stalling the
                # session, and the count says it happened
                self._messages.get_nowait()
                self._messages.put_nowait(incoming)
                self.dropped += 1

        self._loop.call_soon_threadsafe(deliver)

        # the acknowledgement follows the message into the queue, not its
        # arrival: a broker may keep replaying until it is acked, and acking
        # early would lose anything this session never managed to relay
        if message.qos > 0:
            try:
                client.ack(message.mid, message.qos)
            except Exception:
                pass

    def _on_ack(self, kind: str):
        def handler(_client, _userdata, mid, *_rest):
            self._settle(self._pending.get((kind, mid)), True)

        return handler

    async def _await_ack(self, kind: str, mid: int, action: str):
        future = self._loop.create_future()
        self._pending[(kind, mid)] = future
        try:
            await asyncio.wait_for(future, timeout=self.ACK_TIMEOUT)
        except asyncio.TimeoutError as error:
            raise MqttError(
                f"{self.address.display} did not acknowledge {action} within "
                f"{self.ACK_TIMEOUT:g}s."
            ) from error
        finally:
            self._pending.pop((kind, mid), None)

    async def connect(self, timeout: float = CONNECT_TIMEOUT):
        self._connected = self._loop.create_future()
        try:
            # the blocking connect, not connect_async: it raises a refusal or a
            # bad hostname straight away, where connect_async would retry in
            # the background and the failure would arrive as a timeout
            await asyncio.wait_for(
                asyncio.to_thread(self._dial), timeout=timeout
            )
            self._client.loop_start()
        except asyncio.TimeoutError as error:
            await self.close()
            raise MqttError(
                f"Timed out after {timeout:g}s connecting to {self.address.display}."
            ) from error
        except Exception as error:
            await self.close()
            raise MqttError(describe_failure(self.address, error)) from error

        try:
            await asyncio.wait_for(self._connected, timeout=timeout)
        except asyncio.TimeoutError as error:
            await self.close()
            raise MqttError(
                f"Timed out after {timeout:g}s connecting to {self.address.display}."
            ) from error
        except MqttError:
            await self.close()
            raise
        except Exception as error:
            await self.close()
            raise MqttError(describe_failure(self.address, error)) from error

    async def subscribe(
        self,
        topic: str,
        qos: int = 0,
        user_properties: Optional[list] = None,
    ):
        problem = valid_topic_filter(topic)
        if problem:
            raise MqttError(problem)

        result, mid = self._client.subscribe(
            topic, qos=qos, **self._properties("SUBSCRIBE", user_properties)
        )
        if result != 0 or mid is None:
            raise MqttError(f"Could not send the subscribe for '{topic}'.")
        # the SUBACK is what makes the subscription real: a publish sent before
        # it arrives is dropped by the broker, with no error anywhere
        await self._await_ack("subscribe", mid, f"the subscribe to '{topic}'")

    async def unsubscribe(self, topic: str, user_properties: Optional[list] = None):
        result, mid = self._client.unsubscribe(
            topic, **self._properties("UNSUBSCRIBE", user_properties)
        )
        if result != 0 or mid is None:
            raise MqttError(f"Could not send the unsubscribe for '{topic}'.")
        await self._await_ack("unsubscribe", mid, f"the unsubscribe from '{topic}'")

    async def publish(
        self,
        topic: str,
        payload: str,
        qos: int = 0,
        retain: bool = False,
        user_properties: Optional[list] = None,
        content_type: Optional[str] = None,
        response_topic: Optional[str] = None,
        correlation_data: Optional[str] = None,
    ):
        problem = valid_topic_name(topic)
        if problem:
            raise MqttError(problem)

        info = self._client.publish(
            topic,
            payload=str(payload or "").encode("utf-8"),
            qos=qos,
            retain=retain,
            **self._properties(
                "PUBLISH",
                user_properties,
                content_type=content_type,
                response_topic=response_topic,
                correlation_data=correlation_data,
            ),
        )
        if info.rc != 0:
            raise MqttError(f"Could not publish to '{topic}'.")
        if qos > 0:
            await self._await_ack("publish", info.mid, f"the publish to '{topic}'")

    def _dial(self):
        """The blocking connect, with the CONNECT packet this session needs."""
        if not self.options.speaks_v5:
            return self._client.connect(
                self.address.host, self.address.port, DEFAULT_KEEPALIVE
            )
        return self._client.connect(
            self.address.host,
            self.address.port,
            keepalive=DEFAULT_KEEPALIVE,
            clean_start=self.options.clean_start,
            properties=connect_properties(self.options),
        )

    def _properties(self, packet: str, user_properties=None, **fields) -> dict:
        """The properties argument for a packet, or nothing on MQTT 3.

        MQTT 3 has no properties at all, so passing them would be an error
        rather than something the broker ignores.
        """
        if not self.options.speaks_v5:
            return {}
        built = build_properties(packet, pairs_from(user_properties), **fields)
        return {"properties": built} if built else {}

    async def messages(self):
        """Yield messages until the session ends."""
        while True:
            message = await self._messages.get()
            if message is None:
                if self._disconnect_reason:
                    raise MqttError(self._disconnect_reason)
                return
            yield message

    async def close(self):
        self._closed = True
        try:
            self._client.disconnect()
        except Exception:
            pass
        try:
            await asyncio.to_thread(self._client.loop_stop)
        except Exception:
            pass


def reason_code_value(reason_code) -> int:
    try:
        return int(getattr(reason_code, "value", reason_code))
    except (TypeError, ValueError):
        return -1


def connect_properties(options: BrokerOptions):
    """The CONNECT packet's properties: enhanced auth and user properties.

    Enhanced authentication is how a broker takes a JWT or a session secret
    rather than a password - the method names the scheme and the data carries
    the credential.
    """
    from paho.mqtt.packettypes import PacketTypes
    from paho.mqtt.properties import Properties

    properties = Properties(PacketTypes.CONNECT)
    used = False

    if options.auth_method:
        properties.AuthenticationMethod = options.auth_method
        properties.AuthenticationData = (options.auth_data or "").encode("utf-8")
        used = True
    if options.user_properties:
        properties.UserProperty = list(options.user_properties)
        used = True

    return properties if used else None


PACKET_PROPERTIES = ("PUBLISH", "SUBSCRIBE", "UNSUBSCRIBE", "CONNECT")


def build_properties(
    packet: str,
    user_properties: list[tuple[str, str]],
    content_type: Optional[str] = None,
    response_topic: Optional[str] = None,
    correlation_data: Optional[str] = None,
):
    """Assemble one packet's properties, or None when there are none to send."""
    from paho.mqtt.packettypes import PacketTypes
    from paho.mqtt.properties import Properties

    if packet not in PACKET_PROPERTIES:
        return None

    properties = Properties(getattr(PacketTypes, packet))
    used = False

    if user_properties:
        properties.UserProperty = list(user_properties)
        used = True
    if packet == "PUBLISH":
        if content_type:
            properties.ContentType = content_type
            used = True
        if response_topic:
            properties.ResponseTopic = response_topic
            used = True
        if correlation_data:
            properties.CorrelationData = str(correlation_data).encode("utf-8")
            used = True

    return properties if used else None


def read_message_properties(properties) -> dict:
    """Pull an incoming message's MQTT 5 metadata into plain values."""
    empty: dict[str, Any] = {
        "user_properties": [],
        "content_type": None,
        "response_topic": None,
        "correlation_data": None,
        "message_expiry": None,
    }
    if properties is None:
        return empty

    pairs = getattr(properties, "UserProperty", None) or []
    empty["user_properties"] = [[str(key), str(value)] for key, value in pairs]
    empty["content_type"] = getattr(properties, "ContentType", None)
    empty["response_topic"] = getattr(properties, "ResponseTopic", None)

    correlation = getattr(properties, "CorrelationData", None)
    if isinstance(correlation, (bytes, bytearray)):
        try:
            empty["correlation_data"] = bytes(correlation).decode("utf-8")
        except UnicodeDecodeError:
            empty["correlation_data"] = base64.b64encode(bytes(correlation)).decode(
                "ascii"
            )
    elif correlation is not None:
        empty["correlation_data"] = str(correlation)

    expiry = getattr(properties, "MessageExpiryInterval", None)
    empty["message_expiry"] = int(expiry) if expiry is not None else None
    return empty


def is_success(reason_code) -> bool:
    """paho gives an int on MQTT 3 and a ReasonCode on 5."""
    if reason_code is None:
        return True
    failure = getattr(reason_code, "is_failure", None)
    if failure is not None:
        return not failure
    return int(reason_code) == 0


def connect_refusal(
    address: BrokerAddress, reason_code, options: Optional[BrokerOptions] = None
) -> str:
    """CONNACK codes, in the words of what to do about them."""
    try:
        code = int(getattr(reason_code, "value", reason_code))
    except (TypeError, ValueError):
        code = -1

    target = address.display
    if code in (4, 5, 134, 135):
        # a broker using enhanced authentication (Appwrite's takes an
        # `appwrite-session` secret or an `appwrite-jwt`) wants the credential
        # in mqtt_auth_data, not a username and password
        if options is not None and options.auth_method:
            return (
                f"{target} refused the credential for '{options.auth_method}'. "
                "Check mqtt_auth_data - for Appwrite it is a current session "
                "secret or JWT, with the project in a projectId user property."
            )
        return (
            f"{target} refused the credentials. Set mqtt_username and "
            "mqtt_password in the connection's variables."
        )
    if code in (2, 133):
        return (
            f"{target} rejected the client id. It may be reserved, or the "
            "broker may require a specific one."
        )
    if code in (140, 141):
        return (
            f"{target} rejected the authentication method. Check "
            "mqtt_auth_method against what the broker expects."
        )
    if code in (1, 132):
        return (
            f"{target} does not speak MQTT 5. Set mqtt_protocol to 3.1.1 in "
            "the connection's variables - though user properties and enhanced "
            "authentication only exist in 5."
        )
    if code in (3, 136):
        return f"{target} is not accepting connections right now."
    return f"{target} refused the connection ({reason_code})."
