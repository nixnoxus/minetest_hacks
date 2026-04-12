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

function cb_draw_map_fin() {

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
}
map.cb_draw_map_fin = cb_draw_map_fin;
