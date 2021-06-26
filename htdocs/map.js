var api_url = "http://127.0.0.1:8080";
var ix_size = 256;
var iy_size = 256;
var iy_offset = 1;

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
    { zoom: 2
    , grid: 0
    , tool: 'move'
//    , center: { x:-636, z:-348 }
    , center: { x:-620, z:0 }
    , offset: { x:null, z:null }
    , size: {x:null,z:null }
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

    document.getElementById('selection').onmousemove = mousemove;

    //cMap.onmousedown = function(e) {
    cMap.onmousedown = function(e) {
        //console.log("mouse down " + e.target.id);

        mouse.last = mxz(e);
        mouse.button = 1;

        if (mouse.d == "") {
            mouse.d = "se";
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
            map[id] = parseInt(i = document.getElementById(id).value);
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
    now = mxz(e);
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
    var cmap = document.getElementById("cMap");
    
    map.size.x = cmap.width  / map.zoom; 
    map.size.z = cmap.height / map.zoom; 

    var old_offset = { x: map.offset.x, z: map.offset.z };

    map.offset.x = map.center.x - cmap.width  / map.zoom / 2;
    map.offset.z = map.center.z - cmap.height / map.zoom / 2;
                
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

function draw_proc(ctx, taxicap, cmds) {
    var z = map.zoom;
//    g = function(v) { return Math.floor(v); };
    g = function(v) { return Math.round(v); };
    for (var c = 0; c < cmds.length; c++) {
        ctx.strokeStyle = "rgb(200,0,0)";
        cmds[c][1] = g(cmds[c][1]) * z;
        cmds[c][2] = g(cmds[c][2]) * z;
        if (cmds[c][0] == "dot") {
            ctx.moveTo(cmds[c][1], cmds[c][2]);
            ctx.lineTo(cmds[c][1], cmds[c][2]);
        } else if (cmds[c][0] == "moveTo") {
            ctx.moveTo(cmds[c][1], cmds[c][2]);
        } else if (cmds[c][0] == "lineTo") {
            var xx = cmds[c][1] - cmds[c-1][1];
            var yy = cmds[c][2] - cmds[c-1][2];
            if (taxicap && xx && yy) { 
                ctx.stroke();
                ctx.beginPath();

                var axx = Math.abs(xx);
                var ayy = Math.abs(yy);
                if (axx >= ayy) {
                    ctx.strokeStyle = "rgb(0,200,0)";
                    for (var i = 0; i < axx; i += z) {
                        var x = i * ((xx<0) ? -1 : 1);
                        var y = g((x * yy/xx) / z) * z;
                        ctx.moveTo(cmds[c-1][1] + x, cmds[c-1][2] + y);
                        ctx.lineTo(cmds[c-1][1] + x, cmds[c-1][2] + y);
                    }
                } else {
                    ctx.strokeStyle = "rgb(0,0,200)";
                    for (var i = 0; i < ayy; i += z) {
                        var y = i * ((yy<0) ? -1 : 1);
                        var x = g((y * xx/yy) / z) * z;
                        ctx.moveTo(cmds[c-1][1] + x, cmds[c-1][2] + y);
                        ctx.lineTo(cmds[c-1][1] + x, cmds[c-1][2] + y);
                    }
                }
                ctx.stroke();
                ctx.beginPath();

                ctx.moveTo(cmds[c][1], cmds[c][2]);
            } else {
                ctx.lineTo(cmds[c][1], cmds[c][2]);
            }
        }
    }
}

function cmd_octagon1(r) {
    var l = r;         // 7
    var d = ((r-1)/2); // 3

    d = Math.round((r-1)/2/Math.sqrt(2)); //1.4241);

    //console.log("octagon1 r:" + r + " l:" + l + " d:" + d);
    var cmds =
        [ [ "dot", 0, 0 ]
        , [ "moveTo", 0 - d, 0 - l ] // NW
        , [ "lineTo", 0 + d, 0 - l ] // N line
        , [ "lineTo", 0 + l, 0 - d ] // NE
        , [ "lineTo", 0 + l, 0 + d ] // E line  
        , [ "lineTo", 0 + d, 0 + l ] // SE
        , [ "lineTo", 0 - d, 0 + l ] // S line
        , [ "lineTo", 0 - l, 0 + d ] // SW
        , [ "lineTo", 0 - l, 0 - d ] // W line
        , [ "lineTo", 0 - d, 0 - l ] // NW 
        ];

    return cmds;
}

function cmd_polygon(r,e,a) {
    var cmds =
        [ [ "dot", 0, 0 ]
        , [ "moveTo", r * Math.cos(0+a), r * Math.sin(0+a) ]
        ];

    for (var i =1; i <= e; i++)
        cmds.push([ "lineTo"
            , /*Math.round*/(r * Math.cos(i * 2 * Math.PI / e +a))
            , /*Math.round*/(r * Math.sin(i * 2 * Math.PI / e +a))
            ] );

    return cmds;
}

function octagon(cx, cz, r, g = 0) {
    var z = map.zoom;
    var x = Math.round(cx - map.offset.x)*z;
    var y = Math.round(cz - map.offset.z)*z;

    var taxicap = 1;

    var ctx = document.getElementById("cMap").getContext("2d");

    ctx.fillStyle = "rgb(200,0,0)";
    ctx.lineWidth = z;
//    ctx.lineCap = "butt";
    ctx.lineCap = "square";

    let t = ctx.getTransform();
    ctx.translate(x + z/2, y + z/2);
        
    ctx.beginPath();
    //draw_proc(ctx, taxicap, cmd_octagon1(r));

    draw_proc(ctx, taxicap, cmd_polygon(r, 8, (22.5+g) * Math.PI * 2 / 360 ));
    ctx.stroke();

                ctx.beginPath();
                ctx.lineWidth = 1;
//                ctx.moveTo(0,0);
                ctx.strokeStyle = "rgb(200,200,0)";
                ctx.arc(0,0,r*z,0, Math.PI * 2);
                ctx.stroke();

    ctx.setTransform(t);
}

function grid() {
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

    if (0) // vulcan: test draw
        [ 3, 7, 17, 160, 200 ].forEach( i => {
            octagon(-636, -348, i);
        });

    if (1) {
        var r = 6, a = 8; 
        var r = 7, a = 9;
        var r = 8, a = 10; 
        var x,y;

        //if (taxicap) 
        var t = 1;
        r+=t/2;
        a+=t*2;
        for (y = -5; y <= 5; y++)
            for (x = -5; x <= 5; x++) { 
                octagon(-610 +x*(2*a+0)+12*t - a, -a + y*(2*a+0), r);
                octagon(-610 +x*(2*a+0)+12*t,0 + y*(2*a+0),r);
            }
        if (!t) {
            octagon(-610,0,97-a*2-1-3*a-3);
            octagon(-610,0,97-a*2-1);
            octagon(-610,0,97-a*2-1+3*a+2);
        } else {
            octagon(-610,0,97-a*2-1-3*a+2+1-13);
            octagon(-610,0,97-a*2-1-8+1);

            octagon(-610,0,97-a*2-1+3*a+2-7   +5-24,22.5);
            octagon(-610,0,97-a*2-1+3*a+2-7   +5,22.5);
            octagon(-610,0,97-a*2-1+3*a+2-7+14+13,  22.5);
         }
        x = 0;
        y = 0;
        r+=3; a+=3;
                octagon(-610 +x*(2*a+0)+12*t,0 + y*(2*a+0),r);
    }

    if (0) try {
        
        var r = 21, a = 27, cr = 94+14; // 17
        var r = 19, a = 24, cr = 96; // 15  .. 15.6

        var x,y;
        var cx=-610;
        var cy=0;
        //if (taxicap) 
        var t = 1;
        r+=t/2;
        a+=t*2;

        var q=0;
        for (y = -q; y <= q; y++)
            for (x = -q; x <= q; x++) { 
                octagon(cx  +x*2*a-a, cy -a + y*(2*a+0), r);
                octagon(cx  +x*2*a, cy + y*(2*a+0),r);

            }
        var e = 8;
        octagon(cx,cy, cr);

        var a = (22.5) * Math.PI * 2 / 360;
        for (var i =1; i <= e; i++)
            octagon
                ( cx + cr * Math.cos(i * 2 * Math.PI / e +a)
                , cy + cr * Math.sin(i * 2 * Math.PI / e +a)
                , r
                );


    //    octagon(-610,0,97-a*2-1);
    } catch {
    }
 
    grid();
    draw_sel();
    draw_hud();
}

function draw_hud() {
    document.getElementById("zoom").value = map.zoom;
    draw_hud_center(); 
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

function draw_hud_center() {
    var u = api_url + "/#!/map/0/" + u_zoom(map.zoom)
        + "/" + map.center.x
        + "/" + (0 - map.center.z);

    document.getElementById("center").value = map.center.x + "," + map.center.z;
}

function draw_sel() {
    if (! sel.start) return;
    var s = document.getElementById('selection');
    s.removeAttribute("hidden");

    s = s.style;

    s.borderWidth = ((map.zoom >> 1) || 1) + "px";

    s.left = ((Math.min(sel.start.bx, sel.end.bx) -map.offset.x) * map.zoom) + "px";
    s.top  = ((Math.min(sel.start.bz, sel.end.bz)-map.offset.z) * map.zoom ) + "px";
    s.width  = (Math.abs((sel.end.bx) - (sel.start.bx)) * map.zoom) + "px";
    s.height = (Math.abs((sel.end.bz) - (sel.start.bz)) * map.zoom) + "px";
}

function mousemove(e) {
    var now = mxz(e);

    var hud = document.getElementById("koord");
    if (map.tool == "move") {
        hud.innerHTML = "X,Z:"
            + now.bx + "," + now.bz
            + " (" + Math.floor(now.bx /16)
            + "," + Math.floor((now.bz -iy_offset) /16)
            + ")"
            ;
        if (! mouse.button) return;

        // apply delta blocks
        var f = (map.zoom <= 8) ? 2 : 8; // FIXME: random f
        map.center.x += Math.round((mouse.last.mx - now.mx) / map.zoom * f);
        map.center.z += Math.round((mouse.last.my - now.my) / map.zoom * f);

        mouse.last = now;
//        draw_hud_center();
        draw_map_center(1);
        return;
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
        
                hud.innerHTML = "X,Z:" + now.bx + "," + now.bz + "[" +d + "]";

                mouse.d = d;
                if (d != "")
                    document.getElementById("c").style.cursor = d + "-resize";
                else 
                    document.getElementById("c").style.cursor = "default";
            mouse.last = now;
        }
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
   
    var xx,zz;
    hud.innerHTML = "X,Z:"
        + sel.start.bx + "," + sel.start.bz
        + "  " +sel.end.bx + "," + sel.end.bz
        + " (" + (xx = Math.abs(sel.end.bx - sel.start.bx) +1)
        + "*" + (zz = Math.abs(sel.end.bz - sel.start.bz) +1)
        + "=" + (xx*zz)
        + ",d:" + Math.round(Math.sqrt(xx*xx+zz*zz)*10)/10
        + ")"
        ;
}
