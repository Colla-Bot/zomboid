local Commands = {}

Commands.spawnZombie = function(player, args)
  local x = player:getX()
  local y = player:getY()
  local z = player:getZ()
  local rand = ZombRand(21)
  local count = 0
  if rand < 1 then
    count = 10
  elseif rand < 3 then
    count = 9
  elseif rand < 6 then
    count = 8
  elseif rand < 10 then
    count = 7
  elseif rand < 15 then
    count = 6
  else
    count = 5
  end
  addZombiesInOutfitArea(x - 10, y - 10, x + 10, y + 10, z, count, nil, 50)
end

Commands.spawnVehicle = function(player, args)
  local x = player:getX()
  local y = player:getY()
  local z = player:getZ()
  local vehicle = nil;
  local random = ZombRand(4);
  if random == 0 then
    vehicle = "Base.m12warthog"
  elseif random == 1 then
    vehicle = "Base.hmmwvht"
  elseif random == 2 then
    vehicle = "Base.k511_2"
  else
    vehicle = "Base.McLarenF1"
  end
  local vehicle = addVehicleDebug(vehicle, player:getDir(), 0, getCell():getGridSquare(x, y, z))
  vehicle:repair()
  sendServerCommand(player, "SOOPAPI", "claimVehicle", { vehicle = vehicle:getId() })
end

local function OnClientCommand(module, command, player, args)
  if module == 'SOOPAPI' and Commands[command] then
    Commands[command](player, args)
  end
end

Events.OnClientCommand.Add(OnClientCommand)
