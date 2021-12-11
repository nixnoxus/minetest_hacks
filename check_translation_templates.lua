-- check_translation_templates.lua
--
-- Checks for missing strings in <modpath>/locale/template.txt
-- Useful to determine dynamically generated (at runtime) strings.
--
-- Missing templates and strings are logged on the console.
-- The chat command '/tr' displays the missing strings grouped by textdomain.

local cache = {}

local function msg(textdomain, ...)
    print("TRANSLATE["..textdomain.."]: "..(...))
end

local function read_template(modpath, textdomain)
    local dir = modpath .. "/locale/"
    local file = io.open(dir .. "template.txt")
            -- poisonivy.template.trt
              or io.open(dir .. textdomain .. ".template.trt")
            -- toolranks.en.tr
            -- moreores.en.tr
              or io.open(dir .. textdomain .. ".en.tr")
            -- protector.de.tr
            -- basic_materials.de.tr
              or io.open(dir .. textdomain .. ".de.tr")
            -- farbows.es.tr
            -- rcbows.es.tr
              or io.open(dir .. textdomain .. ".es.tr")

    -- see also https://notabug.org/TenPlus1/mobs_redo/pulls/101
    if not file and textdomain == "mobs_redo" then
        file = io.open(dir .."mobs.de_DE.tr")
    end

    if not file then return end

    while true do
        local line = file:read("*line")
        if not line then
            break
        elseif line:sub(1, 1) ~= "#" then
            local l = line:find("=")
            if l then
                cache[textdomain][line:sub(1, l-1)] = { count = 0, in_template = true }
            end
        end
    end
    file:close()

    return true
end

local orig_translate = core.translate
core.translate = function(textdomain, str, ...)
    if not cache[textdomain] then
        cache[textdomain] = {}
        local modname = minetest.get_current_modname()
        if not modname then
            modname = textdomain .. "(*)"
        end
        local modpath = minetest.get_modpath(modname)
        if not modpath then
            msg(textdomain, "nix modpath: "..modname)
        elseif not read_template(modpath, textdomain) then
            -- people
            -- animalworld
            msg(textdomain, "missing template in: " .. modpath)
        end
    end

    if not cache[textdomain][str] then
        cache[textdomain][str] = { count = 0, in_template = false }
        msg(textdomain, "not in template: " .. str)
    end
    cache[textdomain][str].count = cache[textdomain][str].count + 1

    return orig_translate(textdomain, str, ...)
end

local function list_not_in_template(textdomain)
    if not cache[textdomain] then return end
    local first = true
    local grep_args = ""
    for str, v in pairs(cache[textdomain]) do
        if v.in_template == false then
            if first then
                print("textdomain: ".. textdomain)
                first = nil
            end

            print(str .. "=")
            if not string.find(str, "'") then
                grep_args = grep_args .. " -e'S(\""..str.."\"'"
            -- else -- TODO: escape '
            end
        end
    end
    if grep_args ~= "" then
        print("# grep -Fr" .. grep_args .. " .")
    end
    if not first then
        print("")
    end
end

minetest.register_chatcommand("tr", { func = function(name, param)
    if not param or param == "" then
        for textdomain, _ in pairs(cache) do
            list_not_in_template(textdomain)
        end
    elseif param == "t" then
        list_not_in_template("concrete")
        list_not_in_template("extranodes")
        list_not_in_template("technic")
        list_not_in_template("technic_chests")
        list_not_in_template("technic_cnc")
        list_not_in_template("technic_worldgen")
    else
        list_not_in_template(param)
    end
end})
