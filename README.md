# minetest_hacks

## beds (Betten)

### Aenderungen
- Option `enable_bed_in_the_daytime` hinzugefuegt
- Option `bed_night_skip_above_percent` hinzugefuegt

### Installation
`${WORLD}` muss entsprechend angepasst werden
```
# cd ~/minetest/mods
# svn co https://github.com/nixnoxus/minetest_game.git/branches/day_sleeper/mods/beds beds
# echo "load_mod_beds = true" >> ../worlds/${WORLD}/world.mt
# echo "enable_bed_in_the_daytime = yes" >> ../minetest.conf    # am Tage ins Bett gehen (Daycycle weiterhin erst nachts ab ~ 19:20)
# echo "bed_night_skip_above_percent = 30" >> ../minetest.conf  # Daycycle ab > 30% statt bisher > 50% der Spieler moeglich
EOT
```
### Diff
https://github.com/minetest/minetest_game/compare/master...nixnoxus:day_sleeper?expand=1
