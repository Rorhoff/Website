-- Prefix animation tag names with the atlas key so global Phaser anims do not clobber.
-- Optionally rewrite atlas key when producing team recolors (whelp_red, mother_red).

local jsonPath = app.params["jsonPath"]
local atlasKey = app.params["atlasKey"]
local recolor = app.params["recolor"]

if not jsonPath or not atlasKey then
  app.alert("palette-swap.lua requires jsonPath and atlasKey script params")
  return
end

local f = io.open(jsonPath, "r")
if not f then
  app.alert("Cannot read JSON: " .. tostring(jsonPath))
  return
end
local raw = f:read("*a")
f:close()

local obj = json.decode(raw)
if not obj then
  app.alert("Invalid JSON: " .. tostring(jsonPath))
  return
end

local function prefixTag(tag)
  if string.sub(tag, 1, #atlasKey + 1) == atlasKey .. "_" then
    return tag
  end
  return atlasKey .. "_" .. tag
end

if obj.meta and obj.meta.frameTags then
  for _, tag in ipairs(obj.meta.frameTags) do
    tag.name = prefixTag(tag.name)
  end
end

if obj.frames then
  for _, frame in ipairs(obj.frames) do
    if frame.filename then
      frame.filename = prefixTag(frame.filename)
    end
  end
end

if recolor == "red" then
  -- Placeholder hook for indexed palette swap on red team exports.
  -- Artist can extend this to remap palette indices in the PNG separately.
end

local out = json.encode(obj)
f = io.open(jsonPath, "w")
f:write(out)
f:close()
