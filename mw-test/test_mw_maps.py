
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


def test_sprite_upload_and_serve(client):
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
        b"\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    up = client.post(
        "/api/mw/maps/sprite_test/sprites/mother_blue",
        files={"file": ("mother_blue.png", png, "image/png")},
    )
    assert up.status_code == 200
    body = up.json()
    assert body["slot"] == "mother_blue"
    assert body["url"].endswith("/sprites/mother_blue.png")

    got = client.get("/api/mw/maps/sprite_test/sprites/mother_blue.png")
    assert got.status_code == 200
    assert got.content.startswith(b"\x89PNG")

    deleted = client.delete("/api/mw/maps/sprite_test/sprites/mother_blue")
    assert deleted.status_code == 200
