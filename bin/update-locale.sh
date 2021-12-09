#! /bin/bash
#
# update-locale.sh - (Converts and) updates translations for Minetest 5.0.0+
#
# an alternative to https://github.com/minetest-tools/update_translations
# to keep blank lines, comments and translations in the previous order

OPT_DIFF=
OPT_GIT=

error () { # <MESSAGE>
    echo "ERROR: $*" >&2
    exit 1
}

convert_tr () { # <FILE>
    local file="$1" magic="# textdomain: $modname" i=1 script e r cr="
"
    while [ $i -le 8 ]
    do  e="$e\\(.*\\)%[dfs]"
        r="$r\\$i@$i"
        let i++
        script=";s/=$e\\(.*\\)\$/=$r\\$i/$cr$script"
        script=";s/^$e\\(.*\\)=/$r\\$i=/$cr$script"
    done
    script=';s|^\(.\+\S\)\s*=\s*\(.*\)|\1=\2|g'"$cr$script"
    #script=';s/\([@=]\|\\n\)/@&/g'"$cr$script"
    #script=';s/\xc2\xa0/ /g'
    #script=';s/%%/%/g'

    grep -q "^[^#]*=.*=" "$file" && error "bug: can't handle '=' in text:("
    grep -qF "$magic" "$file" || script="1 i $magic\n$cr$script"
    if [ "$OPT_DIFF" = yes ]; then
        sed "$script" "$file" | diff -u "$file" - || test $? -eq 1
    else
        echo "convert $file"
        sed -i "$script" "$file"
    fi
}

update_locale () { # [DIR]
    local dir="${1:-.}"
    local mod_conf="$dir/mod.conf" files
    local template="$dir/locale/template.txt"

    test -f "$mod_conf"|| error "'$mod_conf' not exists"
    local modname="$(sed 's@^name\s*=\s*\(\S\+\)\s*@\1@;tn;d;:n' "$mod_conf")"
    test -n "$modname" || error "modname is not set in $mod_conf"

    test -f "$template" || error "template '$template' not exists"

    files=("$template")

    local src dst
    test "$OPT_DIFF" = yes || for dst in "$dir/locale/$modname".??{,_??}.tr
    do  test -f "$dst" && files[${#files[*]}]="$dst"
    done

    for src in "$dir"/locale/??{,_??}.txt
    do  test -f "$src" || continue
        dst="${src%.txt}".tr
        dst="$dir/locale/$modname.${dst#$dir/locale/}"

        if [ "$OPT_DIFF" = yes ]; then
            dst="$src"
        elif [ ! -f "$dst" ]; then
            if [ "$OPT_GIT" = yes ]; then
                git mv "$src" "$dst"
            else
                mv "$src" "$dst"
            fi
            files[${#files[*]}]="$dst"
            #convert_tr "$dst" || exit $?
        fi
    done

    #convert_tr "$template" || exit $?
    for dst in "${files[@]}"
    do  convert_tr "$dst" || exit $?
    done

    xgettext -L Lua --from-code=UTF-8 --keyword=S -o - $(find "$dir" -name \*.lua) \
        | sed 's@^msgid "\(.*\)"@\1@;tn;d;:n;s/\\"/"/g' \
        | { rc=0
            while read -r line
            do  for file in "${files[@]}"
                do  grep -qF "$line=" "$file" && continue
                    case "$line" in
                    *%[dfs]*)
                        echo "WARNING: illegal placeholder found. message ignored: $line" >&2
                        rc=1
                        continue
                        ;;
                    esac
                    if [ "$OPT_DIFF" = yes ]; then
                        echo "+$line="
                    else
                        echo "$line=" >> "$file"
                    fi
                done
            done
            test "$rc" -eq 0
        }
    test "${PIPESTATUS[*]}" = "0 0 0"
}

while [ $# -ge 1 ]
do  case "$1" in
    -d|--diff)
        OPT_DIFF=yes
        ;;
    --git)
        OPT_GIT=yes
        ;;
    -h|--help)
        cat <<EOT
usage: $0 [OPTION]..
options:
 -h, --help
 -d, --diff
     --git
EOT
        exit
        ;;
    -*) error "unsupported option '$1'"
        ;;
    esac
    shift
done

if [ -f modpack.conf ]; then
    for dir in *
    do  test -d "$dir" || continue
        update_locale "$dir" || exit $?
    done
else
    update_locale .
fi
