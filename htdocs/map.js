var api_url = "http://127.0.0.1:8080";
var ix_size = 256;
var iy_size = 256;
var iy_offset = 0; //1;

function u_zoom(l) {
    var zoom_map =
        { 1:9   // 256/1 blocks
        , 2:10  // 256/2 blocks
        , 4:11
        , 8:12
        , 0.5: 8
        , 0.25: 7
        , 0.125: 6
        , 0.0625: 5
        , 0.03125: 4
        };

    return (zoom_map[l] || 12);
}

var map =
    { zoom: 1
    , grid: 0
    , tool: 'move'
    , center: { x:-620, z:0 }
    , offset: { x:null, z:null }
    , size: {x:null,z:null }
    , cb_draw_map_fin: null
    };

var sel =
    { start: null
    , end: null
    }
var mouse =
    { button: 0
    , last: null
    , d: ""
    };

var _wait = 0;
function wait(add) {
    _wait += (add || 0);
    //console.log("wait " + (add || 0) + "=" + _wait);
    return _wait;
}

function mxz(e) {
    var o = document.getElementById("cMap").getBoundingClientRect();
    var m =
        // relative mouse coordinates
        { mx: e.clientX - o.left
        , my: e.clientY - o.top
        }

        // coresponding map coordinates
    m.bx = map.offset.x + Math.floor(m.mx / map.zoom);
    m.bz = map.offset.z + Math.floor(m.my / map.zoom);
    return m;
}

window.onload = function () {
    var cmap = document.getElementById("cMap");

    var c = document.getElementById("c").getBoundingClientRect();
//console.log("init " + c.width + " x " + c.height);
//console.log("ch " + document.height);
    cmap.width  = c.width;
    cmap.height = c.height;

    var c = document.getElementById("c");
    c.onmousemove = mousemove;

//    document.getElementById('selection').onmousemove = mousemove;

    //cMap.onmousedown = function(e) {
    cMap.onmousedown = function(e) {
        //console.log("mouse down " + e.target.id);

        mouse.last = mxz(e);
        mouse.button = 1;

        if (mouse.d == "")
            mouse.d = "se";

        if (mouse.d == "se" && map.tool == "select") {
            sel.start =
                { bx: mouse.last.bx
                , bz: mouse.last.bz
                };
            sel.end =
                { bx: mouse.last.bx
                , bz: mouse.last.bz
                };
        }
        if (map.tool == "select") {
            document.getElementById("c").style.cursor = "crosshair";

            document.getElementById('koord')
                .style.backgroundColor = 'rgba(180,180,180, 0.9)';

            draw_sel();
            mousemove(e);
        } else if (map.tool == "move") {
            document.getElementById("c").style.cursor = "move";
        }

        draw_hud(e);
        e.preventDefault();
    }
    document.getElementById('selection').onmousedown = cMap.onmousedown;

    document.onmouseup = function(e) {
        //console.log("mouse up");
        if (mouse.button) {
            mouse.button = 0;
//            document.getElementById('selection').setAttribute("hidden", "");
            document.getElementById("c").style.cursor = "default";
            if (map.tool == "move") {
                draw_map();
            } else {
                if (map.tool == "select")
                    document.getElementById('koord')
                        .style.backgroundColor = 'rgba(180,180,180, 0.7)';
                draw_map_fin();
            }
        }
    }

    if (cMap.addEventListener && 1)
        cMap.addEventListener('DOMMouseScroll', wheel, false);

    draw_map_center();

    [ "zoom", "grid" ].forEach(id =>
        document.getElementById(id).onchange = function() {
            if (wait()) return;
            map[id] = parseFloat(i = document.getElementById(id).value);
            //console.log("set " + id + " " + map[id] + " i "+i);
            draw_map_center();
        } );

    document.getElementById("center").onchange = function() {
        if (wait()) return;
        ary = document.getElementById("center").value.split(",");
        map.center.x = parseInt(ary[0]);
        map.center.z = parseInt(ary[1]);

        draw_map_center();
    }

    document.getElementById("tool").onchange = function() {
        map.tool = document.getElementById("tool").value;
    }

    // set current values
/*
    [  "zoom", "grid", "tool" ].map(id => {
        document.getElementById(id).value = map[id];
        });
*/
    var ids = [ "zoom", "grid", "tool" ];
    for (var i = 0; i < ids.length; i++)
        document.getElementById(ids[i]).value = map[ids[i]];
}

function wheel(e) {
    var now = mxz(e);
//    console.log("wheel");
    if (e.detail > 0 && map.zoom > 1/32)
        map.zoom /= 2;
    else if (e.detail < 0 && map.zoom < 32)
        map.zoom *= 2;
    else
        return;

    document.getElementById("zoom").value = map.zoom;

    map.center.x = now.bx;
    map.center.z = now.bz;
    draw_map_center();
}

function draw_map_center(lazy) {
    document.getElementById('selection').setAttribute("hidden", "");
    var cmap = document.getElementById("cMap");

    map.size.x = cmap.width  / map.zoom;
    map.size.z = cmap.height / map.zoom;

    var old_offset = { x: map.offset.x, z: map.offset.z };

    map.offset.x = map.center.x - cmap.width  / map.zoom / 2;
    map.offset.z = 0 - map.center.z - cmap.height / map.zoom / 2;

    var f = (map.zoom <= 8) ? 1 : map.zoom / 8

    ix_size = 256 * f;
    iy_size = 256 * f;

    // block per image
    var b2i = ix_size / map.zoom;
    map.offset.x = Math.round(map.offset.x / b2i) * b2i;
    map.offset.z = Math.round(map.offset.z / b2i) * b2i + iy_offset;

    if (lazy && map.offset.x == old_offset.x && map.offset.z == old_offset.z) {
        //draw_hud_center();
        draw_hud();
        return;
    }

    draw_map(lazy);
}

function draw_map(lazy) {
    var cmap = document.getElementById("cMap");
    var ctx = cmap.getContext("2d");
    //console.log("start");

    for (var iy = 0; iy < cmap.height / iy_size; iy ++) {
        for (var ix = 0; ix < cmap.width / ix_size; ix ++) {
            load_map_img
                ( ix * ix_size
                , iy * iy_size
                , api_url + "/api/tile/0/"
                    + (Math.floor(map.offset.x * map.zoom / ix_size) + ix) + "/"
                    + (Math.floor(map.offset.z * map.zoom / iy_size) + iy) + "/"
                    + u_zoom(map.zoom)
                );
        }
    }
}

function load_map_img(x, y, src) {
    wait(+1);
    var img = new Image();
    img.src = src;
    document.getElementById("cMap").getContext("2d")
        .clearRect(x, y, ix_size, iy_size);
    img.onload = function () {
        document.getElementById("cMap").getContext("2d")
                .drawImage(img, x, y, ix_size, iy_size);
        if (! wait(-1)) draw_map_fin();
    }
/*
    img.onerror = function () {
        document.getElementById("cMap").getContext("2d")
                .clearRect(x, y, ix_size, iy_size);
        if (! --wait) draw_map_fin();
    }
*/
}

function draw_grid() {
    if (map.zoom * map.grid <= 2)
        return;

    var ctx = document.getElementById("cMap").getContext("2d");

//    ctx.beginPath();
    ctx.strokeStyle = "rgb(200,200,200)";
    ctx.lineWidth = 1;
    ctx.lineCap = "butt";

//    ctx.setLineDash([1,1]);

    ctx.beginPath();

    var xx = map.size.x * map.zoom * map.grid;
    var yy = map.size.z * map.zoom * map.grid;

    for (var y = 0; y < yy; y += map.zoom * map.grid) {
        ctx.moveTo(0, y);
        ctx.lineTo(xx, y);
    }
    for (var x = 0; x < xx; x += map.zoom * map.grid) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, yy);
    }

    ctx.stroke();
}

function draw_map_fin() {

    if (mouse.button) return;

    if (map.cb_draw_map_fin) map.cb_draw_map_fin();

    draw_grid();
    draw_sel();
    draw_hud();
}

function draw_hud() {
    document.getElementById("zoom").value = map.zoom;
    //draw_hud_center();
/*
    document.getElementById("center").innerHTML = " |"
        + " <a href='" + u + "'>center</a>"
        + " X:" + c.x
        + " Z:" + c.z
        ;
*/
    document.getElementById("offset").innerHTML = " | offset"
        + " X:" + map.offset.x + "(" + (map.offset.x / (ix_size / map.zoom)) + ")"
        + " Z:" + map.offset.z + "(" + ((map.offset.z-iy_offset) / (iy_size / map.zoom)) + ")"
        ;
}
/*
function draw_hud_center() {
    var u = api_url + "/#!/map/0/" + u_zoom(map.zoom)
        + "/" + map.center.x
        + "/" + (0 - map.center.z);
    console.log("load", u);
    document.getElementById("center").value = map.center.x + "," + map.center.z;
}
*/

function draw_sel() {
//    console.log("sel:", sel.start)
    if (! sel.start) return;
    var e = document.getElementById('selection');
    e.removeAttribute("hidden");

    var s = e.style;

    s.borderWidth = ((map.zoom >> 1) || 1) + "px";

    s.left = ((Math.min(sel.start.bx, sel.end.bx) - map.offset.x) * map.zoom) + "px";
    s.top  = ((Math.min(sel.start.bz, sel.end.bz) - map.offset.z) * map.zoom ) + "px";
    s.width  = (Math.abs((sel.end.bx) - (sel.start.bx)) * map.zoom) + "px";
    s.height = (Math.abs((sel.end.bz) - (sel.start.bz)) * map.zoom) + "px";
}

// callbacks

function mousemove(e) {
    var now = mxz(e);

    var hud = document.getElementById("koord");
    if (map.tool == "move" && mouse.button) {
        // apply delta blocks
        var f = (map.zoom <= 8) ? 2 : 8; // FIXME: random f
        map.center.x += Math.round((mouse.last.mx - now.mx) / map.zoom * f);
        map.center.z -= Math.round((mouse.last.my - now.my) / map.zoom * f);

        mouse.last = now;
//        draw_hud_center();
        draw_map_center(1);
    } else if (map.tool == "select") {
        if (! mouse.button && sel.start) {
            var d = "";
            if (sel.start.bz == now.bz)
                d = "n";
            else if (sel.end.bz == now.bz)
                d = "s";

            if (sel.start.bx == now.bx)
                d = d + "w";
            else if (sel.end.bx == now.bx)
                d = d + "e";

            //hud.innerHTML = "X,Z:" + now.bx + "," + now.bz + "[" +d + "]";

            mouse.d = d;
            if (d != "")
                document.getElementById("c").style.cursor = d + "-resize";
            else
                document.getElementById("c").style.cursor = "default";
            mouse.last = now;
        }

        if (mouse.button) {
            if (mouse.d.includes("n"))
                sel.start.bz = now.bz;
            else if (mouse.d.includes("s"))
                sel.end.bz = now.bz;

            if (mouse.d.includes("w"))
                sel.start.bx = now.bx;
            else if (mouse.d.includes("e"))
                sel.end.bx = now.bx;

            draw_sel();
        }
    }
    if (sel.start) {
        var xx,zz;
        hud.innerHTML = " selected X,Z:"
            + sel.start.bx + "," + (0 - sel.start.bz)
            + "  " +sel.end.bx + "," + (0 - sel.end.bz)
            + " (" + (xx = Math.abs(sel.end.bx - sel.start.bx) +1)
            + "*" + (zz = Math.abs(sel.end.bz - sel.start.bz) +1)
            + "=" + (xx*zz)
            + ",d:" + Math.round(Math.sqrt(xx*xx+zz*zz)*10)/10
            + ")"
            ;
    } else {
        hud.innerHTML = "";
    }
    if (! (map.tool == "select" && mouse.button)) {
        hud.innerHTML = "X,Z:"
            + now.bx + "," + (0 - now.bz)
            + " (" + Math.floor(now.bx /16)
            + "," + Math.floor((now.bz -iy_offset) /16)
            + ")" + hud.innerHTML
            ;
    }
}
