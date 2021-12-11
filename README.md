# minetest_hacks

diverse Hacks für Minetest ...

## andere Hacks (noch offene Patch Requests)

### beds (Betten)

#### Aenderungen
https://github.com/minetest/minetest_game/compare/master...nixnoxus:day_sleeper?expand=1
- Option `enable_bed_in_the_daytime` hinzugefuegt
- Option `bed_night_skip_above_percent` hinzugefuegt

#### Installation
`${WORLD}` muss entsprechend angepasst werden
```bash
cd ~/minetest/mods
svn co https://github.com/nixnoxus/minetest_game.git/branches/day_sleeper/mods/beds beds
echo "load_mod_beds = true" >> ../worlds/${WORLD}/world.mt
cat >> ../minetest.conf <<EOT

# am Tage ins Bett gehen (Daycycle weiterhin erst nachts ab ~ 19:20)
enable_bed_in_the_daytime = yes

# Daycycle ab > 30% statt bisher > 50% der Spieler moeglich
bed_night_skip_above_percent = 30"
EOT
```
