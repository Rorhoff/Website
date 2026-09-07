
def test_map_save_and_publish(client):
    payload = {
        "version": 1,
        "id": "test_arena",
        "name": "Test Arena",
        "width": 1280,
        "height": 720,
        "grid": 8,
        "platforms": [{"id": "p1", "x": 0, "y": 680, "w": 1280, "h": 16, "ground": True}],
        "walls": [],
        "gemSeams": [],
        "hoardSlots": {"blue": [], "red": []},
        "wyrmPath": {"left": 60, "right": 1220, "y": 690, "finishHeight": 110},
        "spawns": {
            "blue": {"main": {"x": 100, "y": 600}, "backup": []},
            "red": {"main": {"x": 1180, "y": 600}, "backup": []},
        },
    }

    save = client.post("/api/mw/maps/save", json=payload)
    assert save.status_code == 200
    assert save.json()["status"] == "draft"

    listed = client.get("/api/mw/maps")
    assert listed.status_code == 200
    assert listed.json()["maps"] == []

    pub = client.post("/api/mw/maps/test_arena/publish", json=payload)
    assert pub.status_code == 200
    assert pub.json()["status"] == "published"

    listed2 = client.get("/api/mw/maps")
    assert any(m["id"] == "test_arena" for m in listed2.json()["maps"])

    got = client.get("/api/mw/maps/test_arena")
    assert got.status_code == 200
    assert got.json()["name"] == "Test Arena"
