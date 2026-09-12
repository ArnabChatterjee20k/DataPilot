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
        with pytest.raises(flows.FlowError, match="one of query, request"):
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


class TestRenderingOddValues:
    """`as_text` is the last thing between a value and a 500.

    Rows are serialised before they reach it, so nothing here should ever
    happen. The point is that being wrong about that costs one odd looking
    cell rather than the endpoint.
    """

    def test_a_uuid_inside_a_row_is_rendered_rather_than_raised(self):
        from uuid import UUID

        rows = [{"id": UUID("49d11d0b-d7b0-431d-8476-ca5f68e59d90")}]

        rendered = flows.as_text(rows)

        assert "49d11d0b-d7b0-431d-8476-ca5f68e59d90" in rendered

    def test_a_reference_to_one_still_resolves(self):
        from uuid import UUID

        outputs = {"n1": {"rows": [{"id": UUID(int=1)}], "row_count": 1}}
        names = {"Ids": "n1", "n1": "n1"}

        text, missing = flows.interpolate("{{Ids.rows}}", outputs, names)

        assert missing == []
        assert "00000000-0000-0000-0000-000000000001" in text

    def test_suggestions_survive_one_too(self):
        from uuid import UUID

        output = {"rows": [{"id": UUID(int=2)}], "row_count": 1, "first": {"id": UUID(int=2)}}

        offered = flows.suggest_references("Ids", flows.QUERY, output)

        assert any("00000000-0000-0000-0000-000000000002" in item["value"] for item in offered)


class TestKindDispatch:
    """Adding a node kind should not mean editing five if/else chains.

    The one that mattered: anything that was not a query fell through to the
    request branch and was handed HTTP response semantics, which is a quiet
    wrong answer rather than a loud one.
    """

    def test_an_unknown_kind_offers_nothing_rather_than_a_response(self):
        offered = flows.node_output("chart", {"rows": [{"id": 1}], "status": 200})

        assert offered == {}

    def test_an_unknown_kind_suggests_no_references(self):
        assert flows.suggest_references("Chart", "chart", {"status": 200}) == []

    def test_a_bad_kind_is_told_what_the_kinds_are(self):
        with pytest.raises(flows.FlowError) as problem:
            flows.read_graph({"nodes": [{"id": "n1", "kind": "chart"}], "edges": []})

        message = str(problem.value)
        assert "'n1' is a 'chart' node" in message
        for kind in flows.KINDS:
            assert kind in message

    def test_a_node_is_stored_with_its_own_fields_only(self):
        graph = flows.read_graph(
            {
                "nodes": [
                    {"id": "n1", "kind": "query", "query": "select 1"},
                    {"id": "n2", "kind": "request", "request": {"path": "/x"}},
                ],
                "edges": [],
            }
        )

        stored = {node["id"]: node for node in flows.to_payload(graph)["nodes"]}

        assert stored["n1"]["query"] == "select 1"
        assert "request" not in stored["n1"]
        assert stored["n2"]["request"] == {"path": "/x"}
        assert "query" not in stored["n2"]

    def test_every_kind_has_a_field_list(self):
        """A kind missing from the table would be stored without its config."""
        assert set(flows.KIND_FIELDS) == set(flows.KINDS)


class TestResolvingOneReference:
    """The lookup behind `{{...}}`, on its own.

    Anything else asking the same question walks this rather than growing a
    second copy of the name index and the path walk.
    """

    outputs = {"n1": {"rows": [{"id": 7}], "row_count": 1, "first": {"id": 7}}}
    names = {"n1": "n1", "Users": "n1"}

    def test_a_value_comes_back_raw(self):
        value, missing = flows.resolve_reference("Users.first.id", self.outputs, self.names)

        assert value == 7
        assert missing is None

    def test_an_unknown_node_says_which_one(self):
        value, missing = flows.resolve_reference("Nope.first.id", self.outputs, self.names)

        assert value is None
        assert "no node called 'Nope'" in missing.reason

    def test_a_path_that_is_not_there_says_where_it_stopped(self):
        value, missing = flows.resolve_reference("Users.first.email", self.outputs, self.names)

        assert value is None
        assert "first.email" in missing.reason


def constants_node(node_id, name, values, **extra):
    return {
        "id": node_id,
        "name": name,
        "kind": "constants",
        "constants": [
            {"key": key, "value": value, "enabled": True} for key, value in values
        ],
        **extra,
    }


class TestConstantsNode:
    """One place to keep a value several nodes share.

    The alternative is the same base URL pasted into three request nodes, and
    a fourth that was missed when it changed.
    """

    def test_its_values_are_offered_downstream(self, client, api_connection):
        uid = create_flow(
            client,
            "Config",
            [
                constants_node("c1", "Config", [("path", "/ping"), ("who", "ada")]),
                request_node("r1", "Call", api_connection["uid"], {"path": "{{Config.path}}"}),
            ],
            [edge("c1", "r1")],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, summary = drain(socket)

        assert summary["failed"] == []
        assert states["c1"]["summary"] == "2 values"
        # the reference resolved, so the request really went to /ping
        assert states["r1"]["result"]["status"] == 200

    def test_a_value_can_be_built_from_an_upstream_node(self, client, api_connection):
        uid = create_flow(
            client,
            "Derived",
            [
                request_node("r1", "Ping", api_connection["uid"], {"path": "/ping"}),
                constants_node("c1", "Config", [("seen", "pong was {{Ping.json.pong}}")]),
            ],
            [edge("r1", "c1")],
        )

        body = client.post(f"/flows/{uid}/nodes/c1/test").json()

        assert body["node"]["state"] == flows.SUCCEEDED
        assert body["node"]["result"]["values"]["seen"] == "pong was true"

    def test_it_needs_no_connection(self, client):
        uid = create_flow(
            client, "Alone", [constants_node("c1", "Config", [("a", "1")])], []
        )

        body = client.post(f"/flows/{uid}/nodes/c1/test").json()

        # every other kind is refused for having no connection chosen
        assert body["node"]["state"] == flows.SUCCEEDED
        assert body["node"]["error"] == ""

    def test_its_keys_are_offered_as_references(self, client):
        uid = create_flow(
            client,
            "Alone",
            [constants_node("c1", "Config", [("api_key", "secret"), ("base", "/v1")])],
            [],
        )

        body = client.post(f"/flows/{uid}/nodes/c1/test").json()

        offered = {item["reference"]: item["value"] for item in body["offers"]}
        assert offered["{{Config.api_key}}"] == "secret"
        assert offered["{{Config.base}}"] == "/v1"

    def test_a_blank_key_is_dropped_rather_than_stored(self, client):
        """The editor always leaves a blank row to type into."""
        uid = create_flow(
            client,
            "Blank",
            [constants_node("c1", "Config", [("a", "1"), ("", "")])],
            [],
        )

        graph = client.get(f"/flows/{uid}").json()["graph"]

        assert graph["nodes"][0]["constants"] == [
            {"key": "a", "value": "1", "enabled": True}
        ]

    def test_two_rows_with_one_key_are_refused(self, client):
        response = client.post(
            "/flows",
            json={
                "name": "Twice",
                "graph": {
                    "nodes": [constants_node("c1", "Config", [("a", "1"), ("a", "2")])],
                    "edges": [],
                },
            },
        )

        assert response.status_code == 400
        assert "two values called 'a'" in response.json()["detail"]

    def test_a_disabled_row_is_kept_but_not_offered(self, client):
        uid = create_flow(
            client,
            "Off",
            [
                {
                    "id": "c1",
                    "name": "Config",
                    "kind": "constants",
                    "constants": [
                        {"key": "on", "value": "1", "enabled": True},
                        {"key": "off", "value": "2", "enabled": False},
                    ],
                }
            ],
            [],
        )

        body = client.post(f"/flows/{uid}/nodes/c1/test").json()

        assert body["node"]["result"]["values"] == {"on": "1"}
        # switched off rather than deleted, so it survives the round trip
        stored = client.get(f"/flows/{uid}").json()["graph"]["nodes"][0]["constants"]
        assert [row["key"] for row in stored] == ["on", "off"]


def with_checks(node, *checks):
    """Attach assertions to any node, whatever kind it is."""
    return {**node, "checks": [{"enabled": True, **check} for check in checks]}


class TestChecks:
    """Assertions on what went into a node and what came out of it.

    They report and never decide: a failed check is a finding about the data,
    and the node it hangs off still succeeded or failed on its own merits.
    """

    def test_a_passing_check_is_reported(self, client, api_connection):
        uid = create_flow(
            client,
            "Checked",
            [
                with_checks(
                    request_node("r1", "Ping", api_connection["uid"], {"path": "/ping"}),
                    {"on": "output", "path": "status", "op": "eq", "value": "200"},
                )
            ],
            [],
        )

        body = client.post(f"/flows/{uid}/nodes/r1/test").json()

        checks = body["node"]["checks"]
        assert len(checks) == 1
        assert checks[0]["passed"] is True
        assert checks[0]["description"] == "status to be 200"
        assert checks[0]["actual"] == "200"

    def test_a_failing_check_does_not_fail_the_node(self, client, api_connection):
        uid = create_flow(
            client,
            "Checked",
            [
                with_checks(
                    request_node("r1", "Ping", api_connection["uid"], {"path": "/ping"}),
                    {"on": "output", "path": "status", "op": "eq", "value": "500"},
                )
            ],
            [],
        )

        body = client.post(f"/flows/{uid}/nodes/r1/test").json()

        # the finding is loud, the verdict is unchanged
        assert body["node"]["checks"][0]["passed"] is False
        assert body["node"]["state"] == flows.SUCCEEDED
        assert body["node"]["error"] == ""

    def test_a_failing_check_does_not_stop_what_comes_after(
        self, client, api_connection
    ):
        uid = create_flow(
            client,
            "Two",
            [
                with_checks(
                    request_node("r1", "One", api_connection["uid"], {"path": "/ping"}),
                    {"on": "output", "path": "status", "op": "eq", "value": "500"},
                ),
                request_node("r2", "Two", api_connection["uid"], {"path": "/ping"}),
            ],
            [edge("r1", "r2")],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, summary = drain(socket)

        assert states["r2"]["state"] == flows.SUCCEEDED
        assert summary["failed"] == []
        assert summary["skipped"] == []
        assert summary["checks"]["failed"] == ["One: status to be 500"]

    def test_the_summary_counts_both_ways(self, client, api_connection):
        uid = create_flow(
            client,
            "Counted",
            [
                with_checks(
                    request_node("r1", "Ping", api_connection["uid"], {"path": "/ping"}),
                    {"on": "output", "path": "status", "op": "eq", "value": "200"},
                    {"on": "output", "path": "ok", "op": "eq", "value": "true"},
                    {"on": "output", "path": "status", "op": "eq", "value": "404"},
                )
            ],
            [],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            _states, summary = drain(socket)

        assert summary["checks"]["passed"] == 2
        assert summary["checks"]["failed"] == ["Ping: status to be 404"]

    def test_an_input_check_reads_what_an_upstream_node_produced(
        self, client, api_connection
    ):
        uid = create_flow(
            client,
            "Upstream",
            [
                request_node("r1", "First", api_connection["uid"], {"path": "/ping"}),
                with_checks(
                    request_node("r2", "Second", api_connection["uid"], {"path": "/ping"}),
                    {"on": "input", "path": "First.status", "op": "eq", "value": "200"},
                ),
            ],
            [edge("r1", "r2")],
        )

        body = client.post(f"/flows/{uid}/nodes/r2/test").json()

        assert body["node"]["checks"][0]["passed"] is True
        assert body["node"]["checks"][0]["actual"] == "200"

    def test_an_input_check_is_reported_even_when_the_node_fails(self, client):
        uid = create_flow(
            client,
            "Broken",
            [
                with_checks(
                    query_node("q1", "Rows", None, "select 1"),
                    {"on": "input", "path": "Nope.id", "op": "exists", "value": ""},
                )
            ],
            [],
        )

        body = client.post(f"/flows/{uid}/nodes/q1/test").json()

        # the node could not run at all, and what went in is still on record
        assert body["node"]["state"] == flows.FAILED
        assert body["node"]["checks"][0]["passed"] is False
        assert "no node called" in body["node"]["checks"][0]["detail"]

    def test_a_check_survives_the_round_trip(self, client, api_connection):
        uid = create_flow(
            client,
            "Saved",
            [
                with_checks(
                    request_node("r1", "Ping", api_connection["uid"], {"path": "/ping"}),
                    {"on": "output", "path": "status", "op": "eq", "value": "200"},
                )
            ],
            [],
        )

        stored = client.get(f"/flows/{uid}").json()["graph"]["nodes"][0]["checks"]

        assert stored == [
            {
                "on": "output",
                "path": "status",
                "op": "eq",
                "value": "200",
                "enabled": True,
            }
        ]

    def test_an_operator_nobody_has_is_refused(self, client, api_connection):
        response = client.post(
            "/flows",
            json={
                "name": "Bad",
                "graph": {
                    "nodes": [
                        with_checks(
                            request_node("r1", "Ping", api_connection["uid"], {}),
                            {"on": "output", "path": "status", "op": "rhymes_with"},
                        )
                    ],
                    "edges": [],
                },
            },
        )

        assert response.status_code == 400
        assert "rhymes_with" in response.json()["detail"]


class TestComparing:
    """The comparisons themselves, without a flow around them."""

    def _run(self, op, actual, expected=""):
        scope = {"value": actual}
        results = flows.check(
            [
                {
                    "on": "output",
                    "path": "value",
                    "op": op,
                    "value": expected,
                    "enabled": True,
                }
            ],
            scope,
            {},
            "output",
        )
        return results[0]

    def test_a_number_and_its_text_are_the_same_answer(self):
        assert self._run("eq", 200, "200")["passed"] is True

    def test_ordering_needs_numbers_and_says_when_it_does_not_have_them(self):
        result = self._run("lt", "later", "5")

        assert result["passed"] is False
        assert "not a number" in result["detail"]

    def test_counting_works_on_a_list(self):
        assert self._run("count_gt", [1, 2, 3], "2")["passed"] is True

    def test_counting_says_when_there_is_nothing_to_count(self):
        result = self._run("count_gt", 7, "2")

        assert result["passed"] is False
        assert "no length to count" in result["detail"]

    def test_a_broken_pattern_reports_itself(self):
        result = self._run("matches", "anything", "[")

        assert result["passed"] is False
        assert "not a valid pattern" in result["detail"]

    def test_emptiness(self):
        assert self._run("empty", [])["passed"] is True
        assert self._run("not_empty", [1])["passed"] is True


def socket_node(node_id, name, connection_id, path="", **extra):
    return {
        "id": node_id,
        "name": name,
        "kind": "socket",
        "connection_id": connection_id,
        "socket": {"path": path},
        **extra,
    }


class TestLiveNodes:
    """Nodes the browser runs, sitting in a graph the server validates."""

    def test_the_server_reports_it_without_running_it(self, client, socket_connection):
        uid = create_flow(
            client,
            "Live",
            [socket_node("s1", "Stream", socket_connection["uid"], "/feed")],
            [],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, summary = drain(socket)

        assert states["s1"]["state"] == flows.LIVE
        assert states["s1"]["summary"] == "runs in your browser"
        assert summary["live"] == ["Stream"]
        assert summary["failed"] == []

    def test_it_does_not_stall_what_comes_after(self, client, socket_connection):
        """A live node never finishes, so anything waiting on it would hang."""
        uid = create_flow(
            client,
            "Live",
            [
                socket_node("s1", "Stream", socket_connection["uid"]),
                socket_node("s2", "Also", socket_connection["uid"]),
            ],
            [edge("s1", "s2")],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, _summary = drain(socket)

        assert states["s2"]["state"] == flows.LIVE

    def test_a_server_node_cannot_read_a_live_one(self, client, socket_connection, api_connection):
        response = client.post(
            "/flows",
            json={
                "name": "Impossible",
                "graph": {
                    "nodes": [
                        socket_node("s1", "Stream", socket_connection["uid"]),
                        request_node("r1", "Notify", api_connection["uid"], {"path": "/echo"}),
                    ],
                    "edges": [edge("s1", "r1")],
                },
            },
        )

        assert response.status_code == 400
        detail = response.json()["detail"]
        assert "runs in your browser" in detail
        assert "'Notify' cannot read it" in detail

    def test_a_live_node_can_read_a_server_one(self, client, socket_connection, api_connection):
        """The useful direction: a query feeding something that draws it."""
        response = client.post(
            "/flows",
            json={
                "name": "Fine",
                "graph": {
                    "nodes": [
                        request_node("r1", "Ping", api_connection["uid"], {"path": "/ping"}),
                        socket_node("s1", "Stream", socket_connection["uid"]),
                    ],
                    "edges": [edge("r1", "s1")],
                },
            },
        )

        assert response.status_code == 200

    def test_it_offers_nothing_to_reference(self, client, socket_connection):
        """Its values live in a tab, so suggesting them would be a lie."""
        assert flows.suggest_references("Stream", flows.SOCKET, {}) == []
        assert flows.node_output(flows.SOCKET, {"anything": 1}) == {}

    def test_its_config_survives_the_round_trip(self, client, socket_connection):
        uid = create_flow(
            client,
            "Live",
            [socket_node("s1", "Stream", socket_connection["uid"], "/feed")],
            [],
        )

        stored = client.get(f"/flows/{uid}").json()["graph"]["nodes"][0]

        assert stored["socket"] == {"path": "/feed"}
        assert "query" not in stored


def graph_node(node_id, name, chart=None, **extra):
    return {
        "id": node_id,
        "name": name,
        "kind": "graph",
        "chart": chart or {"type": "line", "x": "t", "y": ["value"]},
        **extra,
    }


class TestGraphNode:
    """A node that draws, which is the browser's job like any live kind."""

    def test_a_query_can_feed_it(self, client, api_connection):
        """The useful direction: the server runs, the browser draws."""
        response = client.post(
            "/flows",
            json={
                "name": "Drawn",
                "graph": {
                    "nodes": [
                        request_node("r1", "Ping", api_connection["uid"], {"path": "/ping"}),
                        graph_node("g1", "Chart"),
                    ],
                    "edges": [edge("r1", "g1")],
                },
            },
        )

        assert response.status_code == 200

    def test_a_socket_can_feed_it(self, client, socket_connection):
        response = client.post(
            "/flows",
            json={
                "name": "Live chart",
                "graph": {
                    "nodes": [
                        socket_node("s1", "Stream", socket_connection["uid"], "/stream"),
                        graph_node("g1", "Chart"),
                    ],
                    "edges": [edge("s1", "g1")],
                },
            },
        )

        assert response.status_code == 200

    def test_it_cannot_feed_a_request(self, client, api_connection):
        response = client.post(
            "/flows",
            json={
                "name": "Backwards",
                "graph": {
                    "nodes": [
                        graph_node("g1", "Chart"),
                        request_node("r1", "Notify", api_connection["uid"], {"path": "/echo"}),
                    ],
                    "edges": [edge("g1", "r1")],
                },
            },
        )

        assert response.status_code == 400
        assert "runs in your browser" in response.json()["detail"]

    def test_the_server_reports_it_without_running_it(self, client):
        uid = create_flow(client, "Drawn", [graph_node("g1", "Chart")], [])

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, summary = drain(socket)

        assert states["g1"]["state"] == flows.LIVE
        assert summary["live"] == ["Chart"]

    def test_its_settings_survive_the_round_trip(self, client):
        uid = create_flow(
            client,
            "Drawn",
            [graph_node("g1", "Chart", {"type": "bar", "x": "day", "y": ["a", "b"]})],
            [],
        )

        stored = client.get(f"/flows/{uid}").json()["graph"]["nodes"][0]

        assert stored["chart"] == {"type": "bar", "x": "day", "y": ["a", "b"]}
        assert "socket" not in stored


class TestWhatWasSent:
    """Half of "where did the data stop being what I expected" is the input.

    The single-node test has always reported it. A whole run reported only
    what came back, so the one thing worth comparing was missing from the
    place people actually look.
    """

    def test_a_query_reports_the_sql_it_ran(self, client, seeded_sqlite):
        uid = create_flow(
            client,
            "Sent",
            [query_node("q1", "Rows", seeded_sqlite["uid"], "select 1 as id")],
            [],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, _summary = drain(socket)

        assert states["q1"]["sent"] == "select 1 as id"

    def test_a_reference_is_reported_as_the_value_it_became(
        self, client, seeded_sqlite, api_connection
    ):
        uid = create_flow(
            client,
            "Sent",
            [
                query_node("q1", "Users", seeded_sqlite["uid"], "select 7 as id"),
                request_node(
                    "r1",
                    "Notify",
                    api_connection["uid"],
                    {
                        "path": "/echo",
                        "method": "POST",
                        "body_type": "json",
                        "body": '{"id": {{Users.first.id}}}',
                    },
                ),
            ],
            [edge("q1", "r1")],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, _summary = drain(socket)

        # the braces are gone by the time it went out, which is the point
        assert states["r1"]["sent"]["body"] == '{"id": 7}'

    def test_a_constants_node_reports_what_it_resolved_to(self, client):
        uid = create_flow(
            client,
            "Sent",
            [constants_node("c1", "Config", [("a", "1")])],
            [],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, _summary = drain(socket)

        assert states["c1"]["sent"] == {"a": "1"}

    def test_a_node_that_never_ran_sent_nothing(self, client, api_connection):
        uid = create_flow(
            client,
            "Sent",
            [
                request_node("r1", "First", None, {"path": "/ping"}),
                request_node("r2", "Second", api_connection["uid"], {"path": "/ping"}),
            ],
            [edge("r1", "r2")],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, _summary = drain(socket)

        assert states["r2"]["state"] == flows.SKIPPED
        assert states["r2"]["sent"] is None


class TestCheckingEveryRow:
    """Asserting about the data, not only about how much of it there is.

    `row_count more than 0` says a query returned something. It says nothing
    about whether what came back is right, which is the question a test is
    actually asking.
    """

    def _check(self, path, op, value, scope):
        return flows.check(
            [{"on": "output", "path": path, "op": op, "value": value, "enabled": True}],
            scope,
            {},
            "output",
        )[0]

    rows = {
        "rows": [
            {"total": 5, "user": {"id": 1}},
            {"total": 9, "user": {"id": 2}},
        ]
    }

    def test_every_row_passing_passes(self):
        result = self._check("rows.*.total", "gt", "0", self.rows)

        assert result["passed"] is True
        assert result["description"] == "every rows.total to be more than 0"

    def test_one_bad_row_fails_and_says_how_many(self):
        scope = {"rows": [{"total": 5}, {"total": 0}, {"total": 3}]}

        result = self._check("rows.*.total", "gt", "0", scope)

        assert result["passed"] is False
        assert "1 of 3 did not" in result["detail"]
        # the offending value, not the first one, because that is the one to go and look at
        assert result["actual"] == "0"

    def test_it_reaches_through_nested_keys(self):
        result = self._check("rows.*.user.id", "exists", "", self.rows)

        assert result["passed"] is True

    def test_one_row_by_index_still_works(self):
        result = self._check("rows.0.user.id", "eq", "1", self.rows)

        assert result["passed"] is True

    def test_nothing_to_check_is_not_a_pass(self):
        """An empty table quietly passing every check is the worst outcome."""
        result = self._check("rows.*.total", "gt", "0", {"rows": []})

        assert result["passed"] is False
        assert "nothing there to check" in result["detail"]

    def test_it_works_on_what_a_node_received(self, client, seeded_sqlite, api_connection):
        uid = create_flow(
            client,
            "Checked",
            [
                query_node("q1", "Users", seeded_sqlite["uid"], "select id from users"),
                with_checks(
                    request_node("r1", "Notify", api_connection["uid"], {"path": "/ping"}),
                    {"on": "input", "path": "Users.rows.*.id", "op": "gt", "value": "0"},
                ),
            ],
            [edge("q1", "r1")],
        )

        body = client.post(f"/flows/{uid}/nodes/r1/test").json()

        check = body["node"]["checks"][0]
        assert check["passed"] is True
        assert check["description"] == "every Users.rows.id to be more than 0"

    def test_a_row_that_breaks_the_rule_is_found_through_a_whole_run(
        self, client, seeded_sqlite
    ):
        uid = create_flow(
            client,
            "Checked",
            [
                with_checks(
                    query_node(
                        "q1",
                        "Users",
                        seeded_sqlite["uid"],
                        "select id, name from users",
                    ),
                    {"on": "output", "path": "rows.*.name", "op": "ne", "value": "Ada"},
                )
            ],
            [],
        )

        with client.websocket_connect(f"/flows/{uid}/run") as socket:
            read_control(socket, "ready")
            states, summary = drain(socket)

        # the node still succeeded; the finding is about the data
        assert states["q1"]["state"] == flows.SUCCEEDED
        assert summary["checks"]["failed"] == ["Users: every rows.name not to be Ada"]
