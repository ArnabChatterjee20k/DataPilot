"""Flows: a query wired into a request, run once and watched.

Composition, not automation - there is no schedule and no retry here. What is
tested is the two things a flow has to get right: data actually moving along
the edges, and a failure not making everything after it look broken.
"""

import json

import pytest

from api import flows
from api.routes.requests import CONTROL_KEY


def read_control(socket, expected: str | None = None) -> dict:
    frame = json.loads(socket.receive_text())
    assert CONTROL_KEY in frame, f"expected a control frame, got {frame}"
    if expected:
        assert frame[CONTROL_KEY] == expected, frame
    return frame


def drain(socket) -> tuple[dict, dict]:
    """Collect every node report until the run finishes.

    Returns the last state each node reached, and the summary.
    """
    states: dict[str, dict] = {}
    while True:
        frame = json.loads(socket.receive_text())
        if CONTROL_KEY in frame:
            if frame[CONTROL_KEY] == "finished":
                return states, json.loads(frame["detail"])
            if frame[CONTROL_KEY] == "error":
                pytest.fail(f"the flow failed to start: {frame['detail']}")
            continue
        node = frame["node"]
        states[node["id"]] = node


def create_flow(client, name: str, nodes: list, edges: list) -> str:
    response = client.post(
        "/flows", json={"name": name, "graph": {"nodes": nodes, "edges": edges}}
    )
    assert response.status_code == 200, response.text
    return response.json()["uid"]


def query_node(node_id, name, connection_id, query, **extra):
    return {
        "id": node_id,
        "name": name,
        "kind": "query",
        "connection_id": connection_id,
        "query": query,
        **extra,
    }


def request_node(node_id, name, connection_id, request, **extra):
    return {
        "id": node_id,
        "name": name,
        "kind": "request",
        "connection_id": connection_id,
        "request": request,
        **extra,
    }


def edge(source, target):
    return {"id": f"{source}->{target}", "source": source, "target": target}


class TestReadingAGraph:
    def test_a_node_without_a_kind_is_refused(self):
        with pytest.raises(flows.FlowError, match="query or a request"):
            flows.read_graph({"nodes": [{"id": "a"}]})

    def test_two_nodes_cannot_share_an_id(self):
        with pytest.raises(flows.FlowError, match="share the id"):
            flows.read_graph(
                {"nodes": [{"id": "a", "kind": "query"}, {"id": "a", "kind": "query"}]}
            )

    def test_an_edge_to_nowhere_is_refused(self):
        with pytest.raises(flows.FlowError, match="not a node"):
            flows.read_graph(
                {
                    "nodes": [{"id": "a", "kind": "query"}],
                    "edges": [{"source": "a", "target": "ghost"}],
                }
            )

    def test_a_loop_is_named_rather_than_called_invalid(self):
        """Saying which nodes form the loop is the difference between a message
        you can act on and one you cannot."""
        with pytest.raises(flows.FlowError, match="Two →|loop"):
            flows.read_graph(
                {
                    "nodes": [
                        {"id": "a", "kind": "query", "name": "One"},
                        {"id": "b", "kind": "query", "name": "Two"},
                    ],
                    "edges": [
                        {"source": "a", "target": "b"},
                        {"source": "b", "target": "a"},
                    ],
                }
            )

    def test_a_node_cannot_feed_itself(self):
        with pytest.raises(flows.FlowError, match="cannot feed itself"):
            flows.read_graph(
                {
                    "nodes": [{"id": "a", "kind": "query"}],
                    "edges": [{"source": "a", "target": "a"}],
                }
            )

    def test_a_diamond_is_fine(self):
        """One node feeding two, both feeding a third."""
        graph = flows.read_graph(
            {
                "nodes": [{"id": name, "kind": "query"} for name in "abcd"],
                "edges": [
                    {"source": "a", "target": "b"},
                    {"source": "a", "target": "c"},
                    {"source": "b", "target": "d"},
                    {"source": "c", "target": "d"},
                ],
            }
        )
        assert len(graph.nodes) == 4


class TestReferences:
    def _outputs(self):
        return {
            "n1": {
                "rows": [{"id": 7, "name": "Ada"}, {"id": 8, "name": "Bob"}],
                "row_count": 2,
                "first": {"id": 7, "name": "Ada"},
            }
        }

    def _names(self):
        return {"n1": "n1", "Users": "n1"}

    def test_a_field_of_the_first_row(self):
        text, missing = flows.interpolate(
            "/users/{{n1.first.id}}", self._outputs(), self._names()
        )
        assert text == "/users/7"
        assert missing == []

    def test_a_node_can_be_referred_to_by_name(self):
        """The name is what is on the canvas; the id is what the editor made."""
        text, _ = flows.interpolate("{{Users.first.name}}", self._outputs(), self._names())
        assert text == "Ada"

    def test_an_index_into_the_rows(self):
        text, _ = flows.interpolate("{{n1.rows.1.name}}", self._outputs(), self._names())
        assert text == "Bob"

    def test_a_count(self):
        text, _ = flows.interpolate("{{n1.row_count}}", self._outputs(), self._names())
        assert text == "2"

    def test_a_whole_row_becomes_json(self):
        text, _ = flows.interpolate("{{n1.first}}", self._outputs(), self._names())
        assert json.loads(text) == {"id": 7, "name": "Ada"}

    def test_an_unknown_node_is_left_visible_and_reported(self):
        """Blanking it would send nothing and look like it worked."""
        text, missing = flows.interpolate(
            "/users/{{ghost.id}}", self._outputs(), self._names()
        )
        assert text == "/users/{{ghost.id}}"
        assert "no node called 'ghost'" in missing[0].reason

    def test_a_field_that_is_not_there_is_reported(self):
        _, missing = flows.interpolate("{{n1.first.email}}", self._outputs(), self._names())
        assert missing and "produced nothing" in missing[0].reason

    def test_nested_structures_are_interpolated(self):
        spec = {
            "path": "/users/{{n1.first.id}}",
            "headers": [{"key": "X-Name", "value": "{{n1.first.name}}"}],
            "body": '{"count": {{n1.row_count}}}',
        }
        replaced, missing = flows.interpolate_deep(spec, self._outputs(), self._names())
        assert replaced["path"] == "/users/7"
        assert replaced["headers"][0]["value"] == "Ada"
        assert json.loads(replaced["body"]) == {"count": 2}
        assert missing == []


class TestNodeOutput:
    def test_a_query_offers_first_because_that_is_what_gets_typed(self):
        output = flows.node_output(
            flows.QUERY, {"rows": [{"id": 1}], "row_count": 1, "columns": [{"name": "id"}]}
        )
        assert output["first"] == {"id": 1}
        assert output["columns"] == ["id"]

    def test_an_empty_query_has_no_first(self):
        assert flows.node_output(flows.QUERY, {"rows": []})["first"] is None

    def test_a_request_parses_its_json_body(self):
        output = flows.node_output(
            flows.REQUEST, {"status": 201, "body": '{"id": 9}', "headers": []}
        )
        assert output["json"] == {"id": 9}
        assert output["ok"] is True

    def test_a_non_json_body_is_still_readable(self):
        output = flows.node_output(flows.REQUEST, {"status": 500, "body": "nope"})
        assert output["json"] is None
        assert output["body"] == "nope"
        assert output["ok"] is False


class TestFlowCrud:
    def test_a_flow_round_trips(self, client, api_connection):
        uid = create_flow(
            client,
            "Ping",
            [request_node("n1", "Ping", api_connection["uid"], {"path": "/ping"})],
            [],
        )

        body = client.get(f"/flows/{uid}").json()
        assert body["name"] == "Ping"
        assert body["graph"]["nodes"][0]["id"] == "n1"

        listed = client.get("/flows").json()
        assert uid in [flow["uid"] for flow in listed["flows"]]

        assert client.delete(f"/flows/{uid}").status_code == 204
        assert client.get(f"/flows/{uid}").status_code == 404

    def test_a_graph_that_cannot_run_is_refused_on_save(self, client):
        response = client.post(
            "/flows",
            json={
                "name": "Loop",
                "graph": {
                    "nodes": [
                        {"id": "a", "kind": "query", "name": "One"},
                        {"id": "b", "kind": "query", "name": "Two"},
                    ],
                    "edges": [
                        {"source": "a", "target": "b"},
                        {"source": "b", "target": "a"},
                    ],
                },
            },
        )
        assert response.status_code == 400
        assert "loop" in response.json()["detail"]


class TestRunning:
    def test_one_request_node_runs(self, client, api_connection):
        uid = create_flow(
            client,
            "Ping",
            [request_node("n1", "Ping", api_connection["uid"], {"path": "/ping"})],
            [],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, summary = drain(socket)

        assert states["n1"]["state"] == "succeeded"
        assert states["n1"]["summary"].startswith("200")
        assert summary["succeeded"] == 1

    def test_data_moves_along_an_edge(self, client, api_connection):
        """The whole point: what one node produced is what the next one sends."""
        uid = create_flow(
            client,
            "Echo the echo",
            [
                request_node("first", "First", api_connection["uid"], {"path": "/ping"}),
                request_node(
                    "second",
                    "Second",
                    api_connection["uid"],
                    {
                        "path": "/echo",
                        "method": "POST",
                        "body_type": "json",
                        "body": '{"sawPong": {{First.json.pong}}}',
                    },
                ),
            ],
            [edge("first", "second")],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, summary = drain(socket)

        assert summary["failed"] == []
        echoed = json.loads(json.loads(states["second"]["result"]["body"])["body"])
        assert echoed == {"sawPong": True}

    def test_a_node_shows_what_it_produced(self, client, api_connection):
        """A node that hides its output is useless for the only job a flow has."""
        uid = create_flow(
            client,
            "Ping",
            [request_node("n1", "Ping", api_connection["uid"], {"path": "/ping"})],
            [],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, _ = drain(socket)

        assert json.loads(states["n1"]["result"]["body"]) == {"pong": True}
        assert states["n1"]["elapsed_ms"] >= 0

    def test_every_node_reports_before_anything_runs(self, client, api_connection):
        """The canvas needs all of them idle, so a slow flow is not a blank one."""
        uid = create_flow(
            client,
            "Two",
            [
                request_node("a", "A", api_connection["uid"], {"path": "/ping"}),
                request_node("b", "B", api_connection["uid"], {"path": "/ping"}),
            ],
            [edge("a", "b")],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            first = json.loads(socket.receive_text())["node"]
            second = json.loads(socket.receive_text())["node"]
            assert {first["state"], second["state"]} == {"idle"}

    def test_a_failure_does_not_blame_the_nodes_after_it(self, client, api_connection):
        uid = create_flow(
            client,
            "Broken",
            [
                request_node(
                    "bad", "Unreachable", api_connection["uid"],
                    {"path": "http://127.0.0.1:1/nope"},
                ),
                request_node("after", "After", api_connection["uid"], {"path": "/ping"}),
            ],
            [edge("bad", "after")],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, summary = drain(socket)

        assert states["bad"]["state"] == "failed"
        assert "refused" in states["bad"]["error"].lower()

        # never ran is not the same as failed, and calling both "failed" hides
        # which one to go and fix
        assert states["after"]["state"] == "skipped"
        assert states["after"]["blocked_by"] == ["Unreachable"]
        assert summary["failed"] == ["Unreachable"]
        assert summary["skipped"] == ["After"]

    def test_a_branch_that_did_not_depend_on_the_failure_still_runs(
        self, client, api_connection
    ):
        uid = create_flow(
            client,
            "Fork",
            [
                request_node("start", "Start", api_connection["uid"], {"path": "/ping"}),
                request_node(
                    "bad", "Bad", api_connection["uid"], {"path": "http://127.0.0.1:1/x"}
                ),
                request_node("good", "Good", api_connection["uid"], {"path": "/ping"}),
            ],
            [edge("start", "bad"), edge("start", "good")],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, _ = drain(socket)

        assert states["bad"]["state"] == "failed"
        assert states["good"]["state"] == "succeeded"

    def test_a_reference_to_nothing_is_a_warning_on_the_node(
        self, client, api_connection
    ):
        """The node still ran; what it sent is visibly wrong rather than blank."""
        uid = create_flow(
            client,
            "Dangling",
            [
                request_node(
                    "n1",
                    "Echo",
                    api_connection["uid"],
                    {"path": "/echo", "params": [{"key": "who", "value": "{{ghost.id}}"}]},
                )
            ],
            [],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, _ = drain(socket)

        assert states["n1"]["state"] == "succeeded"
        assert states["n1"]["warnings"]
        assert "no node called 'ghost'" in states["n1"]["warnings"][0]

    def test_a_node_with_no_connection_says_so(self, client):
        uid = create_flow(
            client, "Empty", [request_node("n1", "Nowhere", None, {"path": "/ping"})], []
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, _ = drain(socket)

        assert states["n1"]["state"] == "failed"
        assert "no connection chosen" in states["n1"]["error"]

    def test_a_request_node_on_a_database_says_which_node_to_use(
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

        uid = create_flow(
            client, "Wrong", [request_node("n1", "Wrong", created["uid"], {"path": "/x"})], []
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, _ = drain(socket)

        assert states["n1"]["state"] == "failed"
        assert "Use a query node" in states["n1"]["error"]

    def test_an_empty_flow_says_so_rather_than_reporting_success(self, client):
        uid = create_flow(client, "Nothing", [], [])

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            frame = read_control(socket, "error")
            assert "no nodes" in frame["detail"]


@pytest.fixture()
def seeded_sqlite(client):
    """A SQLite connection with rows in it, for crossing the two planes."""
    import io
    import sqlite3
    import tempfile
    from pathlib import Path

    temp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    temp.close()
    path = Path(temp.name)
    database = sqlite3.connect(str(path))
    database.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
    database.executemany(
        "INSERT INTO users (id, name) VALUES (?, ?)", [(7, "Ada"), (8, "Bob")]
    )
    database.commit()
    database.close()

    uploaded = client.post(
        "/bucket",
        files={
            "file": (path.name, io.BytesIO(path.read_bytes()), "application/octet-stream")
        },
    )
    path.unlink(missing_ok=True)
    assert uploaded.status_code == 200, uploaded.text

    created = client.post(
        "/connections",
        json={
            "source": "sqlite",
            "name": "People",
            "connection_uri": uploaded.json()["connection_uri"],
        },
    )
    assert created.status_code == 200, created.text
    return created.json()


class TestAcrossThePlanes:
    """The reason the thing exists: a query feeding a request."""

    def test_a_row_from_the_database_reaches_the_api(
        self, client, seeded_sqlite, api_connection
    ):
        uid = create_flow(
            client,
            "Notify",
            [
                query_node(
                    "db", "Users", seeded_sqlite["uid"],
                    "SELECT id, name FROM users ORDER BY id",
                ),
                request_node(
                    "api",
                    "Notify",
                    api_connection["uid"],
                    {
                        "path": "/echo",
                        "method": "POST",
                        "body_type": "json",
                        "body": '{"id": {{Users.first.id}}, "name": "{{Users.first.name}}", "of": {{Users.row_count}}}',
                    },
                ),
            ],
            [edge("db", "api")],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, summary = drain(socket)

        assert summary["failed"] == [], states
        assert states["db"]["summary"] == "2 rows"
        assert states["db"]["result"]["rows"][0]["name"] == "Ada"

        echoed = json.loads(json.loads(states["api"]["result"]["body"])["body"])
        assert echoed == {"id": 7, "name": "Ada", "of": 2}

    def test_a_query_node_can_read_a_previous_request(
        self, client, seeded_sqlite, api_connection
    ):
        """Both directions, not just database first."""
        uid = create_flow(
            client,
            "Look up what the API said",
            [
                request_node("api", "Ping", api_connection["uid"], {"path": "/ping"}),
                query_node(
                    "db",
                    "Lookup",
                    seeded_sqlite["uid"],
                    "SELECT name FROM users WHERE id = 7 AND '{{Ping.json.pong}}' = 'true'",
                ),
            ],
            [edge("api", "db")],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, summary = drain(socket)

        assert summary["failed"] == [], states
        assert states["db"]["result"]["rows"] == [{"name": "Ada"}]

    def test_two_branches_off_one_query_both_get_the_data(
        self, client, seeded_sqlite, api_connection
    ):
        uid = create_flow(
            client,
            "Fan out",
            [
                query_node("db", "Users", seeded_sqlite["uid"], "SELECT id FROM users"),
                request_node(
                    "left", "Left", api_connection["uid"],
                    {"path": "/echo", "params": [{"key": "id", "value": "{{Users.first.id}}"}]},
                ),
                request_node(
                    "right", "Right", api_connection["uid"],
                    {"path": "/echo", "params": [{"key": "n", "value": "{{Users.row_count}}"}]},
                ),
            ],
            [edge("db", "left"), edge("db", "right")],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, summary = drain(socket)

        assert summary["failed"] == []
        assert json.loads(states["left"]["result"]["body"])["query"] == {"id": "7"}
        assert json.loads(states["right"]["result"]["body"])["query"] == {"n": "2"}

    def test_a_destructive_statement_is_refused(self, client, seeded_sqlite):
        """A flow runs unattended once started, so nothing confirms for you."""
        uid = create_flow(
            client,
            "Dangerous",
            [query_node("db", "Wipe", seeded_sqlite["uid"], "DELETE FROM users")],
            [],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, _ = drain(socket)

        assert states["db"]["state"] == "failed"
        assert "will not run one" in states["db"]["error"]

    def test_a_broken_query_names_the_node_that_broke(self, client, seeded_sqlite):
        uid = create_flow(
            client,
            "Typo",
            [query_node("db", "Typo", seeded_sqlite["uid"], "SELECT * FROM nope")],
            [],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, summary = drain(socket)

        assert states["db"]["state"] == "failed"
        assert summary["failed"] == ["Typo"]


class TestTestingOneNode:
    """Running one node rather than the whole flow.

    Running everything to find out what one node does is a slow way to ask,
    and the branches beside it fire on the way past.
    """

    def test_a_node_runs_on_its_own(self, client, api_connection):
        uid = create_flow(
            client,
            "Ping",
            [request_node("one", "One", api_connection["uid"], {"path": "/ping"})],
            [],
        )

        body = client.post(f"/flows/{uid}/nodes/one/test").json()

        assert body["node"]["state"] == flows.SUCCEEDED
        assert body["node"]["result"]["status"] == 200
        assert body["upstream"] == []

    def test_what_feeds_it_runs_first(self, client, api_connection):
        uid = create_flow(
            client,
            "Echo the echo",
            [
                request_node("first", "First", api_connection["uid"], {"path": "/ping"}),
                request_node(
                    "second",
                    "Second",
                    api_connection["uid"],
                    {
                        "path": "/echo",
                        "method": "POST",
                        "body_type": "json",
                        "body": '{"sawPong": {{First.json.pong}}}',
                    },
                ),
            ],
            [edge("first", "second")],
        )

        body = client.post(f"/flows/{uid}/nodes/second/test").json()

        assert body["node"]["state"] == flows.SUCCEEDED
        assert [run["name"] for run in body["upstream"]] == ["First"]
        # the reference resolved, which is the thing being tested
        assert body["resolved_request"]["body"] == '{"sawPong": true}'

    def test_a_branch_beside_it_is_left_alone(self, client, api_connection):
        """A request that fires on the way past is a surprise nobody asked for."""
        uid = create_flow(
            client,
            "Two branches",
            [
                request_node("root", "Root", api_connection["uid"], {"path": "/ping"}),
                request_node("left", "Left", api_connection["uid"], {"path": "/ping"}),
                request_node("right", "Right", api_connection["uid"], {"path": "/ping"}),
            ],
            [edge("root", "left"), edge("root", "right")],
        )

        body = client.post(f"/flows/{uid}/nodes/left/test").json()

        names = [run["name"] for run in body["upstream"]]
        assert names == ["Root"]
        assert "Right" not in names

    def test_the_references_it_could_use_come_back_with_their_values(
        self, client, api_connection
    ):
        uid = create_flow(
            client,
            "What can I use",
            [
                request_node("first", "First", api_connection["uid"], {"path": "/ping"}),
                request_node("second", "Second", api_connection["uid"], {"path": "/ping"}),
            ],
            [edge("first", "second")],
        )

        body = client.post(f"/flows/{uid}/nodes/second/test").json()

        assert len(body["available"]) == 1
        group = body["available"][0]
        assert group["node"] == "First"
        offered = {item["reference"]: item["value"] for item in group["references"]}
        assert offered["{{First.status}}"] == "200"
        assert "{{First.json.pong}}" in offered

    def test_a_name_with_a_space_is_offered_in_the_form_that_works(
        self, client, api_connection
    ):
        """`{{Get ping.status}}` does not resolve, so it must not be suggested."""
        uid = create_flow(
            client,
            "Spaced",
            [
                request_node("first", "Get ping", api_connection["uid"], {"path": "/ping"}),
                request_node("second", "Second", api_connection["uid"], {"path": "/ping"}),
            ],
            [edge("first", "second")],
        )

        body = client.post(f"/flows/{uid}/nodes/second/test").json()

        offered = [
            item["reference"] for item in body["available"][0]["references"]
        ]
        assert "{{Get_ping.status}}" in offered
        assert "{{Get ping.status}}" not in offered

    def test_a_failure_upstream_is_reported_rather_than_blamed_on_this_node(
        self, client, api_connection
    ):
        uid = create_flow(
            client,
            "Broken upstream",
            [
                # no connection chosen, which is a failure of the node itself
                # rather than a response nobody liked
                request_node("first", "First", None, {"path": "/ping"}),
                request_node("second", "Second", api_connection["uid"], {"path": "/ping"}),
            ],
            [edge("first", "second")],
        )

        body = client.post(f"/flows/{uid}/nodes/second/test").json()

        assert body["node"]["state"] == flows.SKIPPED
        assert body["node"]["blocked_by"] == ["First"]

    def test_a_node_that_is_not_in_the_flow_says_so(self, client, api_connection):
        uid = create_flow(
            client,
            "Ping",
            [request_node("one", "One", api_connection["uid"], {"path": "/ping"})],
            [],
        )

        response = client.post(f"/flows/{uid}/nodes/nope/test")

        assert response.status_code == 404
        assert "Save the flow first" in response.json()["detail"]

    def test_a_tested_node_says_how_to_refer_to_what_it_produced(
        self, client, api_connection
    ):
        """The question is asked while looking at the result, not later."""
        uid = create_flow(
            client,
            "Ping",
            [request_node("one", "One", api_connection["uid"], {"path": "/ping"})],
            [],
        )

        body = client.post(f"/flows/{uid}/nodes/one/test").json()

        offered = {item["reference"]: item["value"] for item in body["offers"]}
        assert offered["{{One.status}}"] == "200"
        assert "{{One.json.pong}}" in offered

class TestValuesThatAreNotJson:
    """A database value the browser cannot be handed directly.

    Adapters return native Python objects - UUID, datetime, Decimal, bytes -
    and a flow that hands one to json.dumps unaided takes the whole run down
    with it, not just the node that produced it.
    """

    @pytest.fixture()
    def sqlite_connection(self, client, sqlite_connection_uri):
        response = client.post(
            "/connections",
            json={
                "source": "sqlite",
                "name": "Files",
                "connection_uri": sqlite_connection_uri,
            },
        )
        assert response.status_code == 200, response.text
        return response.json()

    def test_a_blob_does_not_take_the_run_down(self, client, sqlite_connection):
        uid = create_flow(
            client,
            "Binary",
            [
                query_node(
                    "one",
                    "Blobby",
                    sqlite_connection["uid"],
                    "select x'0102' as payload",
                )
            ],
            [],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, summary = drain(socket)

        assert summary["failed"] == []
        assert states["one"]["state"] == flows.SUCCEEDED

    def test_testing_one_node_survives_it_too(self, client, sqlite_connection):
        uid = create_flow(
            client,
            "Binary",
            [
                query_node(
                    "one",
                    "Blobby",
                    sqlite_connection["uid"],
                    "select x'0102' as payload",
                )
            ],
            [],
        )

        response = client.post(f"/flows/{uid}/nodes/one/test")

        assert response.status_code == 200, response.text
        assert response.json()["node"]["state"] == flows.SUCCEEDED
