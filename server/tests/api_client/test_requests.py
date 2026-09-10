import base64
import json

import httpx
import pytest


def send(client, connection_uid: str, **spec):
    return client.post(f"/connection/{connection_uid}/request", json=spec)


class TestSendingRequests:
    def test_get_reaches_the_upstream_service(self, client, api_connection):
        response = send(client, api_connection["uid"], path="/ping")

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["response"]["status"] == 200
        assert json.loads(data["response"]["body"]) == {"pong": True}
        assert data["response"]["elapsed_ms"] >= 0
        assert data["request"]["method"] == "GET"
        assert data["request"]["url"].endswith("/ping")

    def test_absolute_url_bypasses_the_base(self, client, api_connection, upstream):
        response = send(client, api_connection["uid"], path=f"{upstream.base_url}/ping")

        assert response.status_code == 200
        assert response.json()["response"]["status"] == 200

    @pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
    def test_every_method_is_sent_as_asked(self, client, api_connection, method):
        response = send(client, api_connection["uid"], path="/echo", method=method)

        assert response.status_code == 200, response.text
        echoed = json.loads(response.json()["response"]["body"])
        assert echoed["method"] == method

    def test_query_parameters_are_sent(self, client, api_connection):
        response = send(
            client,
            api_connection["uid"],
            path="/echo",
            params=[
                {"key": "page", "value": "2"},
                {"key": "q", "value": "hello world"},
                {"key": "skipped", "value": "no", "enabled": False},
                {"key": "", "value": "nameless"},
            ],
        )

        echoed = json.loads(response.json()["response"]["body"])
        assert echoed["query"] == {"page": "2", "q": "hello world"}

    def test_headers_are_sent(self, client, api_connection):
        response = send(
            client,
            api_connection["uid"],
            path="/echo",
            headers=[
                {"key": "X-Trace", "value": "abc123"},
                {"key": "X-Off", "value": "nope", "enabled": False},
            ],
        )

        echoed = json.loads(response.json()["response"]["body"])
        assert echoed["headers"]["x-trace"] == "abc123"
        assert "x-off" not in echoed["headers"]

    def test_json_body_is_sent_with_its_content_type(self, client, api_connection):
        response = send(
            client,
            api_connection["uid"],
            path="/echo",
            method="POST",
            body_type="json",
            body='{"name": "Ada"}',
        )

        echoed = json.loads(response.json()["response"]["body"])
        assert json.loads(echoed["body"]) == {"name": "Ada"}
        assert echoed["headers"]["content-type"] == "application/json"

    def test_invalid_json_body_is_rejected_before_sending(self, client, api_connection):
        response = send(
            client,
            api_connection["uid"],
            path="/echo",
            method="POST",
            body_type="json",
            body="{not json",
        )

        assert response.status_code == 400
        assert "not valid JSON" in response.json()["detail"]

    def test_form_body_is_url_encoded(self, client, api_connection):
        response = send(
            client,
            api_connection["uid"],
            path="/echo",
            method="POST",
            body_type="form",
            body=[{"key": "a", "value": "1"}, {"key": "b", "value": "two"}],
        )

        echoed = json.loads(response.json()["response"]["body"])
        assert echoed["body"] == "a=1&b=two"
        assert "x-www-form-urlencoded" in echoed["headers"]["content-type"]

    def test_a_failing_status_is_a_result_not_an_error(self, client, api_connection):
        response = send(client, api_connection["uid"], path="/status/404")

        assert response.status_code == 200
        assert response.json()["response"]["status"] == 404

    def test_binary_response_comes_back_base64(self, client, api_connection):
        response = send(client, api_connection["uid"], path="/binary")

        payload = response.json()["response"]
        assert payload["is_text"] is False
        assert base64.b64decode(payload["body"]) == bytes([0, 1, 2, 3, 255])

    def test_redirects_are_followed_by_default(self, client, api_connection):
        response = send(client, api_connection["uid"], path="/redirect")

        payload = response.json()["response"]
        assert payload["status"] == 200
        assert json.loads(payload["body"]) == {"pong": True}

    def test_redirects_can_be_left_alone(self, client, api_connection):
        response = send(
            client, api_connection["uid"], path="/redirect", follow_redirects=False
        )

        assert response.json()["response"]["status"] == 307

    def test_a_timeout_reports_which_request_failed(self, client, api_connection):
        response = send(client, api_connection["uid"], path="/slow", timeout=1)

        assert response.status_code == 502
        assert "Timeout" in response.json()["detail"]

    def test_an_unreachable_host_is_reported(self, client, api_connection):
        response = send(client, api_connection["uid"], path="http://127.0.0.1:1/nope")

        assert response.status_code == 502

    def test_a_non_http_scheme_is_refused(self, client, api_connection):
        response = send(client, api_connection["uid"], path="file:///etc/passwd")

        assert response.status_code == 400
        assert "http and https" in response.json()["detail"]

    def test_requests_are_refused_on_a_database_connection(
        self, client, sqlite_connection_uri
    ):
        created = client.post(
            "/connections",
            json={
                "source": "sqlite",
                "name": "A database",
                "connection_uri": sqlite_connection_uri,
            },
        ).json()

        response = send(client, created["uid"], path="/ping")
        assert response.status_code == 400
        assert "API connections" in response.json()["detail"]

    def test_queries_are_refused_on_an_api_connection(self, client, api_connection):
        response = client.get(
            f"/connection/{api_connection['uid']}/entities/x/queries",
            params={"query": "SELECT 1"},
        )
        assert response.status_code == 400
        assert "API connection" in response.json()["detail"]


class TestAuth:
    def test_bearer_token(self, client, api_connection):
        response = send(
            client,
            api_connection["uid"],
            path="/echo",
            auth={"type": "bearer", "token": "s3cret"},
        )

        echoed = json.loads(response.json()["response"]["body"])
        assert echoed["headers"]["authorization"] == "Bearer s3cret"

    def test_basic_auth(self, client, api_connection):
        response = send(
            client,
            api_connection["uid"],
            path="/echo",
            auth={"type": "basic", "username": "ada", "password": "lovelace"},
        )

        echoed = json.loads(response.json()["response"]["body"])
        expected = base64.b64encode(b"ada:lovelace").decode()
        assert echoed["headers"]["authorization"] == f"Basic {expected}"

    def test_custom_header_auth(self, client, api_connection):
        response = send(
            client,
            api_connection["uid"],
            path="/echo",
            auth={"type": "header", "name": "X-Api-Key", "value": "abcd"},
        )

        echoed = json.loads(response.json()["response"]["body"])
        assert echoed["headers"]["x-api-key"] == "abcd"

    def test_credentials_are_masked_in_the_echoed_request(self, client, api_connection):
        response = send(
            client,
            api_connection["uid"],
            path="/echo",
            auth={"type": "bearer", "token": "supersecrettoken"},
        )

        sent = {header["key"].lower(): header for header in response.json()["request"]["headers"]}
        assert sent["authorization"]["secret"] is True
        assert "supersecrettoken" not in sent["authorization"]["value"]


class TestVariables:
    def _set(self, client, connection_uid, variables):
        return client.put(
            f"/connection/{connection_uid}/variables", json={"variables": variables}
        )

    def test_variables_are_interpolated_into_path_and_headers(
        self, client, api_connection
    ):
        assert self._set(
            client, api_connection["uid"], {"route": "echo", "trace": "t-1"}
        ).status_code == 200

        response = send(
            client,
            api_connection["uid"],
            path="/{{route}}",
            headers=[{"key": "X-Trace", "value": "{{trace}}"}],
        )

        echoed = json.loads(response.json()["response"]["body"])
        assert echoed["path"] == "/echo"
        assert echoed["headers"]["x-trace"] == "t-1"

    def test_an_unknown_variable_is_left_visible(self, client, api_connection):
        response = send(
            client,
            api_connection["uid"],
            path="/echo",
            headers=[{"key": "X-Trace", "value": "{{nope}}"}],
        )

        echoed = json.loads(response.json()["response"]["body"])
        assert echoed["headers"]["x-trace"] == "{{nope}}"

    def test_secret_variables_are_masked_when_read_back(self, client, api_connection):
        self._set(
            client,
            api_connection["uid"],
            {"api_token": "abcdefghijklmnop", "region": "eu"},
        )

        payload = client.get(f"/connection/{api_connection['uid']}/variables").json()

        assert payload["secret"] == ["api_token"]
        assert payload["variables"]["region"] == "eu"
        assert payload["variables"]["api_token"] != "abcdefghijklmnop"
        assert "•" in payload["variables"]["api_token"]

    def test_a_masked_variable_still_sends_its_real_value(self, client, api_connection):
        self._set(client, api_connection["uid"], {"api_token": "abcdefghijklmnop"})

        response = send(
            client,
            api_connection["uid"],
            path="/echo",
            headers=[{"key": "X-Key", "value": "{{api_token}}"}],
        )

        echoed = json.loads(response.json()["response"]["body"])
        assert echoed["headers"]["x-key"] == "abcdefghijklmnop"


class TestSavedRequests:
    def _create(self, client, connection_uid, **spec):
        payload = {"name": "List users", "method": "GET", "path": "/echo"}
        payload.update(spec)
        return client.post(f"/connection/{connection_uid}/requests", json=payload)

    def test_saving_and_listing(self, client, api_connection):
        created = self._create(client, api_connection["uid"])
        assert created.status_code == 200, created.text
        assert created.json()["name"] == "List users"

        listed = client.get(f"/connection/{api_connection['uid']}/requests").json()
        assert listed["total"] == 1
        assert listed["requests"][0]["uid"] == created.json()["uid"]

    def test_saved_requests_keep_their_parts(self, client, api_connection):
        created = self._create(
            client,
            api_connection["uid"],
            method="POST",
            body_type="json",
            body='{"a": 1}',
            params=[{"key": "page", "value": "1"}],
            headers=[{"key": "X-Trace", "value": "t"}],
            auth={"type": "bearer", "token": "tok"},
        ).json()

        fetched = client.get(
            f"/connection/{api_connection['uid']}/requests/{created['uid']}"
        ).json()

        assert fetched["method"] == "POST"
        assert fetched["body"] == '{"a": 1}'
        assert fetched["params"][0]["key"] == "page"
        assert fetched["headers"][0]["value"] == "t"
        assert fetched["auth"]["type"] == "bearer"

    def test_updating(self, client, api_connection):
        created = self._create(client, api_connection["uid"]).json()

        updated = client.put(
            f"/connection/{api_connection['uid']}/requests/{created['uid']}",
            json={"name": "Renamed", "method": "DELETE", "path": "/echo"},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["name"] == "Renamed"
        assert updated.json()["method"] == "DELETE"

        fetched = client.get(
            f"/connection/{api_connection['uid']}/requests/{created['uid']}"
        ).json()
        assert fetched["name"] == "Renamed"

    def test_deleting(self, client, api_connection):
        created = self._create(client, api_connection["uid"]).json()

        assert (
            client.delete(
                f"/connection/{api_connection['uid']}/requests/{created['uid']}"
            ).status_code
            == 204
        )
        assert (
            client.get(
                f"/connection/{api_connection['uid']}/requests/{created['uid']}"
            ).status_code
            == 404
        )

    def test_requests_are_scoped_to_their_connection(self, client, api_connection, upstream):
        other = client.post(
            "/connections",
            json={
                "source": "api",
                "name": "Other",
                "connection_uri": upstream.base_url,
            },
        ).json()
        created = self._create(client, api_connection["uid"]).json()

        assert (
            client.get(
                f"/connection/{other['uid']}/requests/{created['uid']}"
            ).status_code
            == 404
        )
        assert client.get(f"/connection/{other['uid']}/requests").json()["total"] == 0

    def test_saving_is_refused_on_a_database_connection(
        self, client, sqlite_connection_uri
    ):
        created = client.post(
            "/connections",
            json={
                "source": "sqlite",
                "name": "A database",
                "connection_uri": sqlite_connection_uri,
            },
        ).json()

        response = self._create(client, created["uid"])
        assert response.status_code == 400


class TestApiConnections:
    def test_a_base_url_is_required(self, client):
        response = client.post(
            "/connections",
            json={"source": "api", "name": "Bad", "connection_uri": "not-a-url"},
        )

        assert response.status_code == 400
        assert "http://" in response.json()["detail"]

    def test_status_says_api_connections_are_dialled_per_request(
        self, client, api_connection
    ):
        response = client.get(f"/connections/{api_connection['uid']}/status")

        assert response.status_code == 200
        assert response.json()["reachable"] is True
        assert "per request" in response.json()["detail"]
