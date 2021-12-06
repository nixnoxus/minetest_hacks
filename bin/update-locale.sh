#! /bin/bash
#
# update-locale.sh - (Converts and) updates translations for Minetest 5.0.0+
#
# an alternative to https://github.com/minetest-tools/update_translations
# to keep blank lines, comments and translations in the previous order

GIT=

error () { # <MESSAGE>
    echo "ERROR: $*" >&2
    exit 1
}

convert_tr () { # <FILE>
    local file="$1" magic="# textdomain: $modname"
    echo "convert $file"
    grep -qF "$magic" "$file" || sed -i "1 i $magic\n" "$file"
    sed -i 's|^\(.\+\S\)\s*=\s*\(.*\)|\1=\2|g

        ;s|^\(.*\)%s\(.*\)%s\(.*\)%s\(.*\)=|\1@1\2@2\3@3\4=|
        ;s|=\(.*\)%s\(.*\)%s\(.*\)%s\(.*\)$|=\1@1\2@2\3@3\4|

        ;s|^\(.*\)%s\(.*\)%s\(.*\)=|\1@1\2@2\3=|
        ;s|=\(.*\)%s\(.*\)%s\(.*\)$|=\1@1\2@2\3|

        ;s|^\(.*\)%s\(.*\)=|\1@1\2=|
        ;s|=\(.*\)%s\(.*\)$|=\1@1\2|

        ;s|%s|@1|g
        ' "$file"
}

update_locale () {
    local mod_conf="mod.conf"
    local template="locale/template.txt"

    test -f "$mod_conf"|| error "'$mod_conf' not exists"
    local modname="$(sed 's@^name\s*=\s*\(\S\+\)\s*@\1@;tn;d;:n' "$mod_conf")"
    test -n "$modname" || error "modname is not set in $mod_conf"

    test -f "$template" || error "template '$template' not exists"
    convert_tr "$template" || exit $?

    local file new
    for file in locale/??.txt locale/??_??.txt
    do  test -f "$file" || continue
        new="${file%.txt}".tr
        new="locale/$modname.${new#locale/}"

        if [ "$GIT" = yes ]; then
            git mv "$file" "$new"
        else
            mv "$file" "$new"
        fi
        convert_tr "$new" || exit $?
    done

    xgettext --keyword=S -o - $(find -name \*.lua) \
        | sed 's@^msgid "\(.*\)"@\1=@;tn;d;:n;s@\\"@"@g' | while read -r line
        do  for file in "$template" locale/"$modname".??.tr locale/"$modname".??_??.tr
            do  grep -qF "$line" "$file" && continue
                echo "$line" >> "$file"
            done
        done
}

while [ $# -ge 1 ]
do  case "$1" in
    --git)
        GIT=yes
        ;;
    -h|--help)
        cat <<EOT
usage: $0 [--git]
EOT
        exit
        ;;
    -*) error "unsupported option '$1'"
        ;;
    esac
    shift
done

update_locale
