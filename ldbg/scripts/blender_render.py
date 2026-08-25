#!/usr/bin/env python3
"""Headless Blender render for WebODM georeferenced projects (Addendum A6).

Usage:
  blender --background --python blender_render.py -- /path/to/scene.json

scene.json fields:
  meshObj, meshBaseDir, outputPng, features[], camera{}, sun{}, resolution[], samples
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

FEET_TO_M = 0.3048


def parse_args() -> Path:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    if not argv:
        raise SystemExit("Usage: blender --background --python blender_render.py -- scene.json")
    return Path(argv[0])


def clear_scene() -> None:
    import bpy

    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_mesh(mesh_obj: Path) -> None:
    import bpy

    try:
        bpy.ops.wm.obj_import(filepath=str(mesh_obj))
    except AttributeError:
        bpy.ops.import_scene.obj(filepath=str(mesh_obj))


def sun_elevation_azimuth(lat_deg: float, lon_deg: float, hour: float, day_of_year: int) -> tuple[float, float]:
    """Approximate solar elevation (deg) and azimuth from south (deg) for sun lamp."""
    lat = math.radians(lat_deg)
    decl = math.radians(23.45 * math.sin(math.radians(360 * (284 + day_of_year) / 365)))
    hour_angle = math.radians(15 * (hour - 12))
    sin_el = math.sin(lat) * math.sin(decl) + math.cos(lat) * math.cos(decl) * math.cos(hour_angle)
    elevation = math.degrees(math.asin(max(-1, min(1, sin_el))))
    cos_az = (math.sin(decl) - math.sin(lat) * sin_el) / (math.cos(lat) * math.cos(math.radians(elevation)) + 1e-9)
    azimuth = math.degrees(math.acos(max(-1, min(1, cos_az))))
    if hour_angle > 0:
        azimuth = 360 - azimuth
    return elevation, azimuth


def setup_sun(sun: dict) -> None:
    import bpy

    lat = float(sun.get("lat", 40.76))
    lon = float(sun.get("lon", -111.89))
    hour = float(sun.get("hour", 18))
    doy = int(sun.get("dayOfYear", 172))
    elev, az = sun_elevation_azimuth(lat, lon, hour, doy)

    if "elevationDeg" in sun:
        elev = float(sun["elevationDeg"])
    if "azimuthDeg" in sun:
        az = float(sun["azimuthDeg"])

    bpy.ops.object.light_add(type="SUN", location=(0, 0, 50))
    lamp = bpy.context.active_object
    lamp.data.energy = float(sun.get("energy", 3.0))
    az_rad = math.radians(az)
    el_rad = math.radians(elev)
    lamp.rotation_euler = (math.pi / 2 - el_rad, 0, az_rad)


def setup_camera(cam: dict, bounds: dict) -> None:
    import bpy

    min_x = float(bounds["minX"])
    min_y = float(bounds["minY"])
    max_x = float(bounds["maxX"])
    max_y = float(bounds["maxY"])
    cx = (min_x + max_x) / 2
    cy = (min_y + max_y) / 2
    span = max(max_x - min_x, max_y - min_y, 10)

    preset = cam.get("preset", "rear_hero")
    presets = {
        "front_elevation": {"pos": (cx, max_y + span * 0.9, span * 0.35), "target": (cx, cy, 0)},
        "rear_hero": {"pos": (cx, min_y - span * 0.9, span * 0.45), "target": (cx, cy, 0)},
        "oblique_45": {
            "pos": (max_x + span * 0.7, min_y - span * 0.7, span * 0.9),
            "target": (cx, cy, 0),
        },
        "back_door_eye": {
            "pos": (cx, min_y - span * 0.15, float(cam.get("eyeHeightM", 1.65))),
            "target": (cx, cy, 1.0),
        },
    }
    cfg = presets.get(preset, presets["rear_hero"])
    if "position" in cam and "target" in cam:
        pos = tuple(cam["position"])
        target = tuple(cam["target"])
    else:
        pos = cfg["pos"]
        target = cfg["target"]

    bpy.ops.object.camera_add(location=pos)
    camera = bpy.context.active_object
    direction = (
        target[0] - pos[0],
        target[1] - pos[1],
        target[2] - pos[2],
    )
    camera.rotation_euler = (
        math.atan2(math.hypot(direction[0], direction[1]), direction[2]),
        0,
        math.atan2(direction[0], direction[1]) - math.pi / 2,
    )
    bpy.context.scene.camera = camera
    camera.data.lens = float(cam.get("lensMm", 35))


def add_material(name: str, rgba: tuple[float, float, float, float]) -> object:
    import bpy

    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = 0.6
    return mat


def z_for_feature(feat: dict) -> float:
    if feat.get("targetElevationFeet") is not None:
        return float(feat["targetElevationFeet"]) * FEET_TO_M
    elev = feat.get("elevationFeet") or {}
    if elev.get("mean") is not None:
        return float(elev["mean"]) * FEET_TO_M
    return 0.0


def add_polygon_feature(feat: dict) -> None:
    import bpy

    coords = feat.get("coordinates") or []
    if len(coords) < 3:
        return
    kind = feat.get("kind", "polygon")
    ft = feat.get("featureType", "")
    z = z_for_feature(feat)
    name = feat.get("id", "feature")

    if kind == "point" or ft in ("tree", "tree_specimen"):
        c = coords[0]
        radius = float(feat.get("radiusM") or 2.0)
        height = float(feat.get("heightM") or 4.0)
        bpy.ops.mesh.primitive_cylinder_add(
            radius=radius, depth=height, location=(c["x"], c["y"], z + height / 2)
        )
        obj = bpy.context.active_object
        obj.name = name
        mat = add_material(f"{name}_mat", (0.2, 0.45, 0.2, 1))
        obj.data.materials.append(mat)
        return

    if kind == "polyline" and ft == "retaining_wall":
        for i in range(len(coords) - 1):
            a, b = coords[i], coords[i + 1]
            dx = b["x"] - a["x"]
            dy = b["y"] - a["y"]
            length = math.hypot(dx, dy)
            if length < 0.01:
                continue
            mid_x = (a["x"] + b["x"]) / 2
            mid_y = (a["y"] + b["y"]) / 2
            angle = math.atan2(dy, dx)
            wall_h = float(feat.get("wallHeightM") or 0.6)
            bpy.ops.mesh.primitive_cube_add(
                size=1,
                location=(mid_x, mid_y, z + wall_h / 2),
            )
            obj = bpy.context.active_object
            obj.scale = (length / 2, 0.25, wall_h / 2)
            obj.rotation_euler = (0, 0, angle)
            mat = add_material(f"{name}_wall", (0.55, 0.52, 0.48, 1))
            obj.data.materials.append(mat)
        return

    verts = [(c["x"], c["y"], z) for c in coords]
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.from_pydata(verts, [], [list(range(len(verts)))])
    mesh.update()

    thickness = 0.12
    if ft in ("paver_patio", "concrete", "putting_green"):
        thickness = 0.15
    if ft == "water_feature":
        thickness = 0.05

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.extrude_region_move(
        TRANSFORM_OT_translate={"value": (0, 0, thickness)}
    )
    bpy.ops.object.mode_set(mode="OBJECT")

    color = (0.65, 0.62, 0.58, 1)
    if ft == "water_feature":
        color = (0.15, 0.35, 0.65, 1)
    elif ft == "lawn" or ft == "putting_green":
        color = (0.35, 0.55, 0.28, 1)
    elif ft == "pergola" or ft == "pavilion":
        color = (0.45, 0.32, 0.18, 1)
    mat = add_material(f"{name}_mat", color)
    obj.data.materials.append(mat)


def add_features(features: list[dict]) -> None:
    for feat in features:
        if feat.get("existing"):
            continue
        add_polygon_feature(feat)


def render_scene(scene: dict) -> None:
    import bpy

    clear_scene()

    mesh_obj = Path(scene["meshObj"])
    if not mesh_obj.is_file():
        raise FileNotFoundError(f"Mesh not found: {mesh_obj}")

    import_mesh(mesh_obj)
    add_features(scene.get("features") or [])

    bounds = scene.get("bounds") or {}
    setup_camera(scene.get("camera") or {}, bounds)
    setup_sun(scene.get("sun") or {})

    res = scene.get("resolution") or [1920, 1080]
    bpy.context.scene.render.resolution_x = int(res[0])
    bpy.context.scene.render.resolution_y = int(res[1])
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.cycles.samples = int(scene.get("samples") or 48)
    bpy.context.scene.render.engine = scene.get("engine") or "BLENDER_EEVEE_NEXT"

    out = Path(scene["outputPng"])
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(out)
    bpy.ops.render.render(write_still=True)


def main() -> None:
    scene_path = parse_args()
    scene = json.loads(scene_path.read_text(encoding="utf-8"))
    render_scene(scene)
    print(json.dumps({"ok": True, "outputPng": scene["outputPng"]}))


if __name__ == "__main__":
    main()
