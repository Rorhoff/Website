-- Validate MotherWyrm Aseprite sources before export.
-- Run: aseprite -b --script validate.lua --script-param srcDir=../src

local srcDir = app.params["srcDir"] or "."
local MAX_PALETTE = 64

local EXPECTED = {
  ["whelp.aseprite"] = { "idle", "run", "jump", "fall", "punt", "stun", "death" },
  ["mother.aseprite"] = { "idle", "flap", "dive", "claw", "hurt", "death" },
  ["wyrm.aseprite"] = { "crawl" },
}

local errors = {}

local function fail(msg)
  errors[#errors + 1] = msg
end

local function lowestOpaqueRow(img, frame)
  local minY = nil
  for y = 0, img.height - 1 do
    for x = 0, img.width - 1 do
      local p = img:getPixel(x, y)
      local a = app.pixelColor.rgbaA(p)
      if a == 255 then
        if minY == nil or y > minY then
          minY = y
        end
        break
      end
    end
  end
  return minY
end

local function validateFile(path, filename)
  local sprite = app.open(path)
  if not sprite then
    fail(filename .. ": cannot open")
    return
  end

  local canvasW, canvasH = sprite.width, sprite.height
  local expectedTags = EXPECTED[filename]

  for _, tag in ipairs(sprite.tags) do
    local baseY = nil
    for _, frame in ipairs(tag.frames) do
      local cel = sprite.cels[frame]
      if cel then
        local img = cel.image
        if img.width ~= canvasW or img.height ~= canvasH then
          fail(string.format("%s tag %s frame %d: canvas %dx%d != file %dx%d",
            filename, tag.name, frame, img.width, img.height, canvasW, canvasH))
        end

        for y = 0, img.height - 1 do
          for x = 0, img.width - 1 do
            local a = app.pixelColor.rgbaA(img:getPixel(x, y))
            if a > 0 and a < 255 then
              fail(string.format("%s tag %s frame %d: semi-transparent pixel at (%d,%d) alpha=%d",
                filename, tag.name, frame, x, y, a))
            end
          end
        end

        local row = lowestOpaqueRow(img, frame)
        if baseY == nil then
          baseY = row
        elseif row ~= baseY then
          local drift = math.abs((row or 0) - (baseY or 0))
          fail(string.format("%s tag %s frame %d: baseline is %dpx high (expected row %d)",
            filename, tag.name, frame, drift, baseY))
        end
      end
    end
  end

  if expectedTags then
    local found = {}
    for _, tag in ipairs(sprite.tags) do
      found[tag.name] = true
    end
    for _, name in ipairs(expectedTags) do
      if not found[name] then
        fail(filename .. ": missing tag '" .. name .. "'")
      end
    end
  end

  local palette = sprite.palettes[1]
  if palette and #palette > MAX_PALETTE then
    fail(filename .. ": palette has " .. #palette .. " colors (max " .. MAX_PALETTE .. ")")
  end

  sprite:close()
end

for name, _ in pairs(EXPECTED) do
  local path = srcDir .. "/" .. name
  local f = io.open(path, "r")
  if f then
    f:close()
    validateFile(path, name)
  else
    -- Source not checked in yet — skip quietly during partial art rollout.
  end
end

if #errors > 0 then
  for _, e in ipairs(errors) do
    print("ERROR: " .. e)
  end
  app.alert("Art validation failed:\n" .. table.concat(errors, "\n"))
else
  print("Art validation passed.")
end
