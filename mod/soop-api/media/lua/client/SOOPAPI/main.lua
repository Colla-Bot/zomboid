local bind = {}
bind.value = "[SOOP]"
table.insert(keyBinding, bind)

bind = {}
bind.value = "TOGGLE_SOOP_WINDOW"
bind.key = Keyboard.KEY_F8
table.insert(keyBinding, bind)

local function delayedFunctionExecution(func, delay)
  delay = delay or 1;
  local ticks = 0;
  local function delayed()
    if ticks < delay then
      ticks = ticks + 1;
      return;
    end
    Events.OnTick.Remove(delayed);
    func();
  end
  Events.OnTick.Add(delayed);
end

local ApiBox = {
  BasicApiBox = {
    ["Base.GummyBears"] = 1,
    ["Base.Crisps;Base.Gunbang"] = 2,
  },
}

local CumulativeProb = {}
local TotalProb = {}
for box, items in pairs(ApiBox) do
  CumulativeProb[box] = {}
  local sum = 0
  for item, prob in pairs(items) do
    sum = sum + prob
    CumulativeProb[box][item] = sum
  end
  TotalProb[box] = sum
end

function OnApiBoxOpen(items, result, player)
  for i = 0, items:size() - 1 do
    local type = items:get(i):getType()
    if CumulativeProb[type] then
      local rand = ZombRand(TotalProb[type])
      for entry, prob in pairs(CumulativeProb[type]) do
        if rand < prob then
          for name in string.gmatch(entry, "[^;]+") do
            local item = player:getInventory():AddItem(name)
            player:Say(string.format(getText("UI_item_message"), getItemNameFromFullType(name)))
            if instanceof(item, "HandWeapon") then
              if item:getMagazineType() then
                item:setContainsClip(true)
              end
              local ammoBox = item:getAmmoBox()
              if ammoBox then
                player:getInventory():AddItem(ammoBox)
              end
            end
          end
          break
        end
      end
    end
  end
end

function OnVehicleSpawn(items, result, player)
  sendClientCommand(player, "SOOPAPI", "spawnVehicle", {})
end

local function killPlayer(type, nickname, count)
  local player = getPlayer()
  processGeneralMessage(string.format(getText("UI_kill_message"), nickname, count))
  player:setHealth(0)
end

ApiEffect = {
  [10000] = { func = killPlayer },
  [5000] = { item = "Base.EpicApiBox", count = 11 },
  [1000] = { item = "Base.LegendApiBox" },
  [666] = { server = "spawnZombie" },
  [500] = { item = "Base.EpicApiBox" },
  [119] = { item = "Base.Cigarettes" },
  [100] = { item = "Base.CommonApiBox" },
  [50] = { item = "Base.BasicApiBox" },
}

local function OnSoopBalloon(type, nickname, count)
  local player = getPlayer()
  local effect = ApiEffect[count]
  if not effect then
    return
  end
  player:Say(string.format(getText("UI_balloon_message"), nickname, count))
  if effect.item then
    if effect.count then
      player:getInventory():AddItems(effect.item, effect.count)
    else
      player:getInventory():AddItem(effect.item)
    end
    player:Say(string.format(getText("UI_item_message"), getItemNameFromFullType(effect.item)))
  elseif effect.func then
    effect.func(type, nickname, count)
  elseif effect.server then
    sendClientCommand(player, "SOOPAPI", effect.server, { type = type, nickname = nickname, count = count })
  end
end

LuaEventManager.AddEvent("OnSoopBalloon")
Events.OnSoopBalloon.Add(OnSoopBalloon)

Events.OnServerCommand.Add(function(module, command, args)
  local player = getPlayer()
  if module == 'SOOPAPI' then
    if command == "claimVehicle" then
      local vehicleId = args.vehicle
      delayedFunctionExecution(function()
        local vehicle = getVehicleById(vehicleId)
        if vehicle then
          player:getInventory():AddItem(vehicle:getCurrentKey() or vehicle:createVehicleKey())
        end
      end, 20)
    end
  end
end)
