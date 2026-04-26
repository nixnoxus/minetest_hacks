#!/usr/bin/env python3

import argparse
import copy
import json
import logging
import os
import re
import sys
import sqlite3
import struct
import zstandard

MAP_BLOCKSIZE = 16

def assert_eq(val, expected, key = "val"):
    __tracebackhide__ = True
    assert val == expected, f"{key}: {val} is not equals {expected}"

def assert_in(val, expected, key = "val"):
    __tracebackhide__ = True
    assert val in expected, f"{key}: {val} is not in {expected}"

def hexdump(data):
    return "".join(" %02X" % b for b in data) + " " + "".join("%s" % ((32 <= b and b <=127) and chr(b) or ".") for b in data)

def strip_null(o):
    for k,v in list(o.items()):
        if isinstance(v, dict):
            v = strip_null(v)
            o[k] = v
        if v == None or v == [] or v == {}:
            del o[k]
    return o

def dumper(o, level = 0):
    ary = []
    for k,v in o.items():
        if v != None and type(v) not in [ dict, list ]:
            ary.append(k + "=" + str(v))

    if len(ary):
        print(" " * level + " ".join(ary))
        level +=1

    for k,v in o.items():
        if type(v) == dict and v != {}:
            print(" " * level + k + ":")
            dumper(v, level = level + 1)
        elif type(v) == list and v != []:
            print(" " * level + k + ":")
            for e in v:
                if type(e) == dict:
                    if e != {}: dumper(e, level = level + 1)
                elif type(e) == list:
                    if e != []: print(" " * (level + 1) + " ".join(e))
                elif e != None:
                    print(" " * (level + 1) + e)

class Vec:
    def __init__(self, x=None, y=None, z=None):
        self.x = x
        self.y = y
        self.z = z

    #def __str__(self):
    #    return f"({self.x}, {self.y}, {self.z})"

    def __repr__(self):
        return f"({self.x}, {self.y}, {self.z})"

    def offset(self, other):
        v = Vec()
        v.x = self.x + other.x
        v.y = self.y + other.y
        v.z = self.z + other.z
        return v

    def diff(self, other):
        v = Vec()
        v.x = self.x - other.x
        v.y = self.y - other.y
        v.z = self.z - other.z
        return v

    def distance(self, other):
        v = self.diff(other)
        return max(abs(v.x), abs(v.y), abs(v.z))

    def radius(self, r:int):
        assert r == abs(r)
        for x in range(-r, r +1):
            for y in range(-r, r +1):
                for z in range(-r, r +1):
                    yield Vec(self.x +x, self.y +y, self.z +z)

class VecStat:
        funcs = [ 'min', 'max', 'sum' ]

        def __init__(self, *vecs):
            for func in __class__.funcs:
                setattr(self, func, Vec())

            self.count = 0

            self.add(*vecs)

        def add(self, *vecs):

            def each(func, dst:Vec, src:Vec):
                for key in [ 'x', 'y', 'z' ]:
                    d = getattr(dst, key)
                    s = getattr(src, key)
                    if s is None:
                        return
                    elif d is None:
                        setattr(dst, key, s)
                    elif func == 'sum':
                        setattr(dst, key, d +s)
                    elif func == 'min':
                        if s < d: setattr(dst, key, s)
                    elif func == 'max':
                        if s > d: setattr(dst, key, s)
                    else:
                        raise ValueError(f"unsupported func: {func}")

            for src in vecs:
                for func in __class__.funcs:
                    each(func, getattr(self, func), src)

                self.count += 1

        def __repr__(self):
            ary = []
            for key in [ 'x', 'y', 'z' ]:
                ary.append(f"{getattr(self.min, key)} <= {key} <= {getattr(self.max, key)}")
            return ",".join(ary)

        def as_dict(self):
            data = { 'count': self.count }
            for key in [ 'x', 'y', 'z' ]:
                data[key] = {}
                for func in __class__.funcs:
                    data[key][func] = getattr(getattr(self, func), key)
            return data

class Vector(Vec): # ~ MapBlock
    def __init__(self, block_pos):
        if type(block_pos) == int:
            self._by_blocks_pos(block_pos)
        elif isinstance(block_pos, Vec):
            self._by_vec(block_pos)
        elif type(block_pos) == str:
            m = re.search(r'^\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*$', block_pos)
            assert m
            self._by_vec(Vec \
                ( int(m.group(1)) // MAP_BLOCKSIZE
                , int(m.group(2)) // MAP_BLOCKSIZE
                , int(m.group(3)) // MAP_BLOCKSIZE
                ))
            self.pos = (int(m.group(1)) % MAP_BLOCKSIZE) * (MAP_BLOCKSIZE**0) \
                +  (int(m.group(2)) % MAP_BLOCKSIZE) * (MAP_BLOCKSIZE**1) \
                +  (int(m.group(3)) % MAP_BLOCKSIZE) * (MAP_BLOCKSIZE**2)
            #print(self.__dict__)
        else:
            raise ValueError(f"unsupported type: {type(block_pos)}")

    def _by_blocks_pos(self, block_pos:int):
        self.block_pos = block_pos
        vec = self.pos2vec()
        self.x = vec.x
        self.y = vec.y
        self.z = vec.z
        self.pos = None

        assert_eq(self.block_pos, self.vec2pos(), "block_pos")

    def _by_vec(self, vec:Vec):
        self.x = vec.x
        self.y = vec.y
        self.z = vec.z
        self.block_pos = self.vec2pos()
        self.pos = None

    def pos2vec(self):
        def unsignedToSigned(i:int, max_positive:int):
            if i < max_positive:
                return i
            else:
                return i - 2*max_positive

        i = self.block_pos
        x = unsignedToSigned(i % 4096, 2048)
        i = int((i - x) / 4096)
        y = unsignedToSigned(i % 4096, 2048)
        i = int((i - y) / 4096)
        z = unsignedToSigned(i % 4096, 2048)
        return Vec(x,y,z)

    def vec2pos(self):
        def int64(u:int):
            while u >= 2**63:
                u -= 2**64
            while u <= -2**63:
                u += 2**64
            return u

        return int64(self.z * 16777216 + self.y * 4096 + self.x)

    def node_pos(self, pos:int = None):
        pos = pos or self.pos or 0
        return Vec \
            ( self.x * MAP_BLOCKSIZE + int(pos // (MAP_BLOCKSIZE**0)) % MAP_BLOCKSIZE
            , self.y * MAP_BLOCKSIZE + int(pos // (MAP_BLOCKSIZE**1)) % MAP_BLOCKSIZE
            , self.z * MAP_BLOCKSIZE + int(pos // (MAP_BLOCKSIZE**2)) % MAP_BLOCKSIZE
            )


class Node:
    def __init__(self, name, param1, param2):
        self.name = name
        self.param1 = param1
        self.param2 = param2

class Object:
    def __init__(self, pos, name, data=None, hp=None, velocity=None, yaw=None, version2=None, pitch=None, roll=None):
        self.pos = pos
        self.name = name
        self.hp = hp
        self.velocity = velocity
        self.yaw = yaw
        self.version2 = version2
        self.pitch = pitch
        self.roll = roll
        self.data = data

class Timer:
    def __init__(self, pos, timeout, elapsed):
        self.pos = pos
        self.timeout = timeout
        self.elapsed = elapsed

class Block:
    def __init__(self, block_pos, blockdata):
        self.vector = Vector(block_pos)
        self.version = struct.unpack('B', blockdata[0:0 + 1])[0]
        logging.info("block block_pos: %s (%s) pos %s version: %d zstd bytes: %d"
            , block_pos, self.vector
            , self.vector.node_pos(0)
            , self.version
            , len(blockdata) -1
            )
        assert_eq(self.version, 29, "version")

        dctx = zstandard.ZstdDecompressor()
        decompressor = dctx.decompressobj()

        self.data = decompressor.decompress( blockdata[1:])
        #print(f" bytes: {len(self.data)} rest: {len(decompressor.unused_data)}")
        assert_eq(len(decompressor.unused_data), 0)

        self.ptr = 0

        def p_get(t, c = None, expect = None):
            t2f = { "u8": "B"
                , "u16": ">H"
                , "s16": ">h"
                , "u32": ">I"
                , "s32": ">i"
                }
            l = struct.calcsize(t2f[t]) * (c or 1)
            if c is not None:
                assert_eq(t, "u8")
                v = self.data[self.ptr:self.ptr + c]
            else:
                v = struct.unpack(t2f[t], self.data[self.ptr:self.ptr + l])[0]

            self.ptr += l

            if expect is not None:
                assert_eq(v, expect)

            return v

        self.flags = p_get("u8")
        self.lighting_complete = p_get("u16")
        self.timestamp = p_get("u32")
        self.name_id_mapping_version = p_get("u8", expect = 0)
        self.num_name_id_mappings = p_get("u16")

        #for attrname in [ "flags", "lighting_complete", "timestamp", "num_name_id_mappings"]:
        #    print(f" {attrname}: {getattr(self, attrname)}")

        self.id2name = {}
        for n in range(0, self.num_name_id_mappings):
            id = p_get("u16")
            l = p_get("u16")
            self.id2name[id] = p_get("u8", l).decode()

        self.content_width = p_get("u8", expect = 2)
        self.params_width = p_get("u8", expect = 2)

        self.node_ptr = self.ptr
        """
        for i in range(0, 4096):
            v = self.get_param0(i)
            self.id2count[v] += 1

            if not self.id2name[v] in block_stat:
                block_stat[self.id2name[v]] = { "count": 0, "y": {} }

            block_stat[self.id2name[v]]["count"] += 1

            y = i / self.MAP_BLOCKSIZE % self.MAP_BLOCKSIZE

            if not y in block_stat[self.id2name[v]]["y"]:
                block_stat[self.id2name[v]]["y"][y] = 0

            block_stat[self.id2name[v]]["y"][y] += 1

        for i in self.id2name.keys():
            print(f" {self.id2count[i]:5d} x {i:5d} -> {self.id2name[i]:20s}")
        """

        # node data
        self.ptr += 2*4096 +4096 + 4096

        # node metadata list
        self.metadata_version = p_get("u8")
        self.count_of_metadata = p_get("u16")
        #logging.debug(" node metadata version %d count %d", self.metadata_version, self.count_of_metadata)
        self.meta_ptr = self.ptr

        if self.metadata_version:
            assert_eq(self.metadata_version, 2, "metadata version")
            assert self.count_of_metadata > 0
        else:
            assert self.count_of_metadata == 0

        self.metadata = {}
        self.inventory = {}

        for i in range(0, self.count_of_metadata):
            pos = p_get("u16")
            logging.debug(" metadata %d/%d pos %d %s node.name %s"
                , 1 + i, self.count_of_metadata
                , pos, self.vector.node_pos(pos), self.id2name[self.get_param0(pos)]
                )
            self.metadata[pos] = {}

            num_vars = p_get("u32")
            #logging.debug("  num_vars %d", num_vars)
            for n in range(0, num_vars):
                key_len = p_get("u16")
                key = p_get("u8", key_len).decode()
                val_len = p_get("u32")
                val = p_get("u8", val_len).decode()
                is_private = p_get("u8")
                self.metadata[pos][key] = val
                logging.debug("  var %d/%d %s=%s (is_private:%s)", 1 +n, num_vars, key, val, is_private)

            x = self.data[self.ptr:].partition(b"EndInventory\n")
            i = x[0] + x[1]
            self.ptr =  self.ptr + len(i) #+ 2
            if len(x[0]):
                self.inventory[pos] = {}
                logging.debug("  serialized inventory: %s", x[0].decode())
                class Inv:
                    def __init__(self, blob):
                        self.lines = blob.decode().split("\n")
                        self.l = 0

                    def get(self):
                        cols = self.lines[self.l].split(" ")
                        #print("#", self.l, len(self.lines))
                        #print("#", self.lines[self.l], " -> cols:", cols)
                        self.l = self.l +1
                        return cols

                    def get_key(self, key):
                        cols = self.get()
                        assert_eq(cols[0], key)
                        return cols

                inv = Inv(x[0])
                while inv.l < len(inv.lines) -1:
                    key, name, count = inv.get_key("List")
                    key, width = inv.get_key("Width")
                    self.inventory[pos][name] = []
                    for i in range(0, int(count)):
                        cols = inv.get()
                        if cols[0] == "Item":
                            self.inventory[pos][name].append(cols[1:])
                        else:
                            assert_eq(cols[0], "Empty")
                            self.inventory[pos][name].append(None)
                    inv.get_key("EndInventoryList")

        #logging.debug(" after metadata [%d] rest %d bytes: %s", self.ptr, len(self.data) - self.ptr, self.data[self.ptr:])

        """
        x = p_get("u8", expect = 0)
        self.static_object_count = p_get("u16")
        """

        if self.count_of_metadata > 0: #wtf?
            x = p_get("u16", expect = 0)

        # static objects
        self.static_object_count = p_get("u8")
        self.object = []

        if self.static_object_count > 0:
            for n in range(0, self.static_object_count):
                b = p_get("u8")
                assert_eq(b, 7, "lua entry")

                pos = Vec(p_get("s32") / 10000, p_get("s32") / 10000, p_get("s32") / 10000)
                data_size = p_get("u16")
                data_ptr = self.ptr

                c = p_get("u8", expect = 1) # compatibility_byte (always 1)
                l = p_get("u16")
                name = p_get("u8", l).decode() # entity name
                l = p_get("u32")
                data = p_get("u8", l).decode() # static data
                hp_y = self.data[self.ptr]

                o = Object \
                    ( pos = pos
                    , name = name
                    , data = data
                    , hp = p_get("s16") # -18
                    , velocity = Vec(p_get("s32"), p_get("s32"), p_get("s32"))
                    , yaw = p_get("s32") # rotation.Y
                    )

                logging.debug(" object %d/%d '%s' pos %s hp %i %s"
                    , 1 + n, self.static_object_count
                    , o.name, self.vector.node_pos(0).offset(o.pos)
                    , o.hp, o.data[:20] + "..."
                    )
                #logging.warning(" [%d] var rest %d bytes: %s", self.ptr, len(self.data) - self.ptr, hexdump(self.data[self.ptr:]))

                o.version2 = p_get("u8") #, expect = 1)
                if o.version2 == 1:
                    o.pitch = p_get("s32") # rotation.X
                    o.roll  = p_get("s32") # rotation.Z
                    assert_eq(hp_y != 0, False, "not hp > 255")
                    assert_eq(len(o.data) == 0, False, "not empty static data")
                else: # ?
                    assert_eq(o.version2, 0, "version2")
                    #self.ptr += 7
                    assert_eq(p_get("u32"), 0, "nix pitch")
                    assert_eq(p_get("u16"), 0, "nix u16")
                    assert_eq(p_get("u8"), 0, "nix u8")
                    o.pitch = 0
                    o.roll = 0
                    assert_eq(hp_y != 0, True, "hp > 255")
                    assert_eq(len(o.data) == 0, True, "empty static data")
                    #o.pitch = p_get("s32", expect = 0)
                    #o.roll = p_get("s32") #, expect = 7)

                #if hp_y != 0: #b'\n': # WTF ?
                #    self.ptr -= 1

                logging.debug("  object Y:%s hp:%i v2:%d pitch:%i roll:%i", hp_y, o.hp, o.version2, o.pitch, o.roll)
                assert_eq(self.ptr, data_ptr + data_size, "end data ptr")

                self.object.append(o)

        # node timers
        self.timer = []
        assert_eq(p_get("u8"), 10, "length of timer")
        self.num_of_timers = p_get("u16")
        if self.num_of_timers > 0:
                for i in range(0, self.num_of_timers):
                    self.timer.append(Timer\
                        ( pos = p_get("u16")
                        , timeout = p_get("s32") / 1000
                        , elapsed = p_get("s32") / 1000
                        ))
                    t = self.timer[-1]
                    logging.debug(" timer %d/%d pos %d %s node %s timeout %f elapsed %f"
                        , 1 + i, self.num_of_timers
                        , t.pos, self.vector.node_pos(t.pos), self.id2name[self.get_param0(t.pos)]
                        , t.timeout, t.elapsed
                        )

        assert_eq(len(self.data) - self.ptr, 0, "rest")

        """
            p = None
            for s in [ b'mcl_', b'mobs_', b'__builtin' ]:
                i = self.data[self.ptr:].find(s)
                if i > -1 and (p is None or p > i):
                    p = i
                    m = s

            if p:
                assert p == 17
                logging.warning(" X %s found at %d, before:%s", m, p, self.data[self.ptr:][:p-1-3*4-1])
        """

    def get_param0(self, i):
        assert i in range(0, 4096)
        o = i*2
        return struct.unpack(">H", self.data[self.node_ptr + o:self.node_ptr + o + 2])[0]

    def get_param1(self, i):
        assert i in range(0, 4096)
        o = 4096 * 2 + i
        return struct.unpack("B", self.data[self.node_ptr + o:self.node_ptr + o + 1])[0]

    def get_param2(self, i):
        assert i in range(0, 4096)
        o = 4096 * 3 + i
        return struct.unpack("B", self.data[self.node_ptr + o:self.node_ptr + o + 1])[0]

    def name2id(self, node_name):
        if node_name in self.id2name.values():
           return list(self.id2name.keys())[list(self.id2name.values()).index(node_name)]

    def get_node(self, i):
        assert i in range(0, 4096)
        p0 = i * 2
        id = struct.unpack(">H", self.data[self.node_ptr + p0:self.node_ptr + p0 + 2])[0]
        p1 = 4096 * 2 + i
        p2 = 4096 * 3 + i
        return Node \
            ( name = self.id2name[id]
            , param1 = struct.unpack("B", self.data[self.node_ptr + p1:self.node_ptr + p1 + 1])[0]
            , param2 = struct.unpack("B", self.data[self.node_ptr + p2:self.node_ptr + p2 + 1])[0]
            )

    def get_metadata(self, pos, var = None):
        if not pos in self.metadata:
            return None
        elif var is None:
            return self.metadata[pos]
        elif var in self.metadata[pos]:
            return self.metadata[pos][var]
        else:
            return None

    def get_inventory(self, pos, list = None):
        if not pos in self.inventory:
            return None
        elif list is None:
            return self.inventory[pos]
        elif list in self.inventory[pos]:
            return self.inventory[pos][list]
        else:
            return None

    def get_timer(self, pos):
        for t in self.timer:
            if t.pos == pos: return t

    def dump_node(self, pos, key:str = None, **kwargs):
        t = self.get_timer(pos)
        t = t and { **t.__dict__, "pos": None }
        dumper({ key or str(self.vector.node_pos(pos)): {
             **{ **self.vector.node_pos(pos).__dict__
               , **self.get_node(pos).__dict__
               }
            , "metadata": self.get_metadata(pos)
            , "inventory": self.get_inventory(pos)
            , "timer": t
            , **kwargs
            }})


class Map:
    def __init__(self, sqlite_file, args):
        self.db = sqlite3.connect(sqlite_file)
        self.db.row_factory = sqlite3.Row

        cur = self.db.cursor()
        res = cur.execute("PRAGMA table_info(`blocks`)")
        rows = res.fetchall()
        if len(rows) == 2:
            assert rows[0][1] == "pos", rows[0][1]
            assert rows[1][1] == "data", rows[1][1]
            self.world_ge_5_12 = False
        else:
            assert len(rows) == 4
            assert rows[0][1] == "x", rows[0][1]
            assert rows[1][1] == "y", rows[1][1]
            assert rows[2][1] == "z", rows[2][1]
            assert rows[3][1] == "data", rows[3][1]
            self.world_ge_5_12 = True

            def sel_block(v:Vector = None):
                if v is None:
                    return ("SELECT `x`, `y`, `z`, `data` FROM `blocks`")
                else:
                    return ("SELECT `x`, `y`, `z`, `data` FROM `blocks` WHERE `x` == ? AND `y` == ? AND `z` == ?", (v.x, v.y, v.z,))
            def row2block(row):
                return Block(Vec(row['x'], row['y'], row['z']), row['data'])

            __class__.sel_block = sel_block
            __class__.row2block = row2block

        self.args = args
        self.vectors = []
        for b in args.node_pos:
            self.vectors.append(Vector(b))

        self.node_stat = VecStat()
        self.node_vecs = []

        if not self.args.json:
            self.short_keys = list(chr(a) for a in \
                ( *list(range(ord("A"),ord("Z")+1))
                , *list(range(ord("0"),ord("9")+1))
                , *list(range(ord("a"),ord("z")+1))
                ))
        else:
            self.short_keys = []

    @staticmethod
    def row2block(row):
        return Block(row['pos'], row['data'])

    @staticmethod
    def sel_block(v:Vector = None):
        if v is None:
            return ("SELECT `pos`, `data` FROM `blocks`")
        else:
            return ("SELECT `pos`, `data` FROM `blocks` WHERE `pos` == ?", (v.block_pos,))

    def iter_blocks(self):
        cur = self.db.cursor()

        if len(self.vectors) == 0:
            for row in cur.execute(__class__.sel_block(None)):
                yield __class__.row2block(row)
        else:
            for v in self.vectors:
                for v in v.radius(self.args.radius):
                    for row in cur.execute(*__class__.sel_block(v)):
                        yield __class__.row2block(row)

    def get_short_key(self, i:int) -> str:
        return str(self.short_keys[i] if i < len(self.short_keys) else i)

    def dump_node(self, block:Block, pos):
        v = block.vector.node_pos(pos)

        kwargs = {}
        if len(self.vectors) == 1 and self.vectors[0].pos is not None:
            kwargs["distance"] = { "nodes": v.distance(self.vectors[0].node_pos()) }

        i = len(self.node_vecs)
        block.dump_node(pos, self.get_short_key(i), **kwargs)

        self.node_stat.add(v)
        self.node_vecs.append(v)

    def visualize(self):
        if self.node_stat.count == 0: return

        if len(self.vectors) == 1:
            node_stat = copy.deepcopy(self.node_stat)
            node_stat.add(self.vectors[0].node_pos())
        else:
            node_stat = self.node_stat

        o_len = max(len(str(y)) for y in \
            [ node_stat.min.y
            , node_stat.max.y
            , node_stat.min.z
            , node_stat.max.z
            ])

        x_len_max, y_len_max = os.get_terminal_size()
        x_len_max = (x_len_max or 80) -2 - o_len -1
        y_len_max = (y_len_max or 25) -2

        def scale(xx, l):
            if xx <= l:
                return (1, xx)
            else:
                return (xx / l, l)

        x_div, x_len = scale(node_stat.max.x - node_stat.min.x +1, x_len_max)

        # X scala
        x_min = node_stat.min.x
        ox_len = max(len(str(x)) for x in \
            [ node_stat.min.x
            , node_stat.max.x
            ])

        s_ord = f"{'':{o_len}}"
        s_top = s_ord
        s_btm = s_ord
        for i in range(0, int(min(x_len_max, x_len) / (ox_len+1))):
            s_ord += f" {int(x_min + i*x_div*(ox_len+1) + x_div/2):{ox_len}}"
            s_top += f" {'v':{ox_len}}"
            s_btm += f" {'^':{ox_len}}"
        print()
        print(s_ord)
        print(s_top)

        def show(ordinate):
            y_min = getattr(node_stat.min, ordinate)
            y_div, y_len = scale(getattr(node_stat.max, ordinate) - y_min +1, y_len_max)

            rows = []
            for y in range(y_len):
                rows.append("")
                for x in range(x_len):
                    rows[y] += "."

            def mark_vector(v:Vec, c:str):
                x = int((v.x - node_stat.min.x) / x_div)
                y = int((getattr(v, ordinate) - y_min) / y_div)
                if 0 <= x and x < x_len and 0 <= y and y < y_len:
                    if len(c) > 1:
                        c = '(' + c + ')'
                    rows[y] = rows[y][:x] + c + rows[y][x+len(c):]

            def mark_border(v1:Vec, v2:Vec):
                v = VecStat(v1, v2)

                def v_set(v:Vec, ordinate:str, value:int):
                    v2 = Vec(v.x, v.y, v.z)
                    setattr(v2, ordinate, value)
                    return v2

                def v_lines(v:VecStat, ordinate:str, c:str):
                    v_min = getattr(v.min, ordinate)
                    v_max = getattr(v.max, ordinate)

                    for value in range(v_min +1, v_max):
                        mark_vector(v_set(v.min, ordinate, value), c)
                        mark_vector(v_set(v.max, ordinate, value), c)

                    mark_vector(v_set(v.min, ordinate, v_min), "+")
                    mark_vector(v_set(v.min, ordinate, v_max), "+")
                    mark_vector(v_set(v.max, ordinate, v_min), "+")
                    mark_vector(v_set(v.max, ordinate, v_max), "+")

                v_lines(v, "x", "-")
                v_lines(v, ordinate, "|")


            # mark basis vector and borders
            if len(self.vectors) == 1:
                if self.vectors[0].pos is not None:
                    v = self.vectors[0].node_pos()
                    vb = Vec \
                        ( v.x // MAP_BLOCKSIZE * MAP_BLOCKSIZE
                        , v.y // MAP_BLOCKSIZE * MAP_BLOCKSIZE
                        , v.z // MAP_BLOCKSIZE * MAP_BLOCKSIZE
                        )

                    # 0: current MapBlock
                    # 4: active MapBlocks
                    for r in [ 0, 2, 4 ]:
                        o_min = (0 - r) * MAP_BLOCKSIZE
                        o_max = (1 + r) * MAP_BLOCKSIZE
                        mark_border(vb.offset(Vec(o_min, o_min, o_min)), vb.offset(Vec(o_max, o_max, o_max)))

                    mark_vector(v, "*")

            for i in range(0, len(self.node_vecs)):
                mark_vector(self.node_vecs[i], self.get_short_key(i))

            print(f"{ordinate} +/-{y_div/2:.2f} \\ x +/-{x_div/2:.2f}")
            for y in range(y_len):
                i = y_len -1 -y
                print(f"{int(y_min + i*y_div + y_div/2):{o_len}} "  + rows[i])
            print()
        show("z")
        print(s_btm)
        print(s_ord)
        print(s_top)
        show("y")
        print(s_btm)
        print(s_ord)

    def get_block_pos_stat(self):
        stat = VecStat(*(block.vector for block in self.iter_blocks()))
        dumper({ "block": stat.as_dict() })

    def get_block_stat(self):
        block_stat = {}

        for block in self.iter_blocks():
            id2count = {}
            for p in range(0, 4096):
                id = block.get_param0(p)

                if not id in id2count:
                    id2count[id] = 0

                name = block.id2name[id]
                if not name in block_stat:
                    block_stat[name] = { 'count': 0, 'y': {} }

                block_stat[name]['count'] += 1

                y = block.vector.y + (p // MAP_BLOCKSIZE) % MAP_BLOCKSIZE

                if not y in block_stat[name]['y']:
                    block_stat[name]['y'][y] = 0

                block_stat[name]['y'][y] += 1

        """
        if len(self.vectors) == 0:
            with open("block-stat.json", "w") as f:
                json.dump(block_stat, f, indent=4)
        """

        return block_stat

    def print_block_stat(self, use_dumper = False):
        if True or len(self.vectors) > 0:
            block_stat = self.get_block_stat()
        else:
            with open("block-stat.json", "r") as f:
                def str2num(d):
                    if type(d) == dict:
                        for k in list(d.keys()):
                            if re.search(r'^-?[0-9]+$', k):
                                d[int(k)] = d[k]
                                del d[k]
                                k = int(k)
                            if type(d[k]) == dict:
                                d[k] = str2num(d[k])
                    return d

                block_stat = str2num(json.load(f))

        if use_dumper:
            return dumper(block_stat)

        #total = sum(v['count'] for k,v in block_stat.items() if k != "air")
        #total = sum(v['count'] for v in block_stat.values())

        total = 0
        length = { "name": 0, "count": 0, "y": 6, "percent": 5+1 }
        def max_length(key, v):
            l = len(str(v))
            if length[key] < l: length[key] = l

        for name,v in block_stat.items():
            total += v["count"]
            max_length("name", name)
            max_length("count", v["count"])

        try:
            columns = os.get_terminal_size().columns
        except:
            columns = 80

        columns_n = columns - length["count"] - length["name"] - length["percent"] - 3 - 2
        if columns_n < 0:
            columns_n = 0
            fmt_n = "{:0}"
        else:
            fmt_n = " [{:" + str(columns_n) + "}]"

        columns_y = columns - length["count"] - length["y"]    - length["percent"] - 3 - 2
        if columns_y < 0:
            columns_y = 0
            fmt_y = "{:0}"
        else:
            fmt_y = " [{:" + str(columns_y) + "}]"

        fmt_n = "{:-" + str(length["count"]) + "} {:" + str(length["name"]) + "} {:5.2f}%" + fmt_n
        fmt_y = "{:-" + str(length["count"]) + "} {:" + str(length["y"])   + "}{:1}{:5.2f}%" + fmt_y

        for n in sorted(block_stat.keys(), key=lambda n: block_stat[n]['count']):
            f = block_stat[n]['count'] / total
            print(fmt_n.format(block_stat[n]['count'], n, 100 * f, "#" * int(columns_n * f)))
            #continue
            y_sorted = sorted(block_stat[n]['y'], reverse = True)
            y_count = len(y_sorted)
            for i in range(0, y_count):
                y = y_sorted[i]
                f = block_stat[n]['y'][y] / block_stat[n]['count']
                b = "_" if i < y_count -1 and y // MAP_BLOCKSIZE != y_sorted[i+1] // MAP_BLOCKSIZE else " "
                print(fmt_y.format(block_stat[n]['y'][y], y, b, 100 * f, "=" * int(columns_y * f)))

    def _find_node(self, names, var=None, val=None):
        def _by_name(block, id):
            return block.id2name[id] == names

        def _by_re_names(block, id):
            for re_name in names:
                if re.search(re_name, block.id2name[id]):
                    return True

        cb_filter_name = type(names) == list and _by_re_names or _by_name

        def cb_filter_arg(block, id, pos):
            v = block.get_metadata(pos, var)
            if callable(val):
                return val(v)
            else:
                return val is None or v == val

        for block in self.iter_blocks():
            for id in filter(lambda id: cb_filter_name(block,id), block.id2name.keys()):
                for pos in filter(lambda pos: id == block.get_param0(pos), range(0, 4096)):
                    if var == None or cb_filter_arg(block, id, pos):
                        yield id, block, pos

    def find_node(self, names, var=None, val=None):
        for id, block, pos in self._find_node(names, var, val):
            self.dump_node(block, pos)

    def find_neighbor_node(self, node_name, var=None, val=None):
        ary = []
        for id, block, pos in self._find_node(node_name, var, val):
            v = block.get_metadata(pos, var)
            logging.info("found %s @ %s %s=%s", node_name, block.vector.node_pos(pos), var, v)
            ary.append(block.vector.node_pos(pos))

        pairs = []
        for a in range(0, len(ary)-1):
            for b in range(a+1, len(ary)):
                pairs.append(\
                    { "distance": ary[a].distance(ary[b])
                    , "pos1": str(ary[a])
                    , "pos2": str(ary[b])
                    })
        dumper({ "neighbors": list(sorted(pairs, key=lambda n: n["distance"])) })

    def find_item(self, item_name):
        for block in self.iter_blocks():
            for pos in block.inventory.keys():
                for list in block.inventory[pos].keys():
                    for ary in block.inventory[pos][list]:
                        if ary and ary[0] == item_name:
                            self.dump_node(block, pos)

    def find_object(self, object_name):
        for block in self.iter_blocks():
            for o in block.object:
                if o.name == object_name:
                    dumper(o.__dict__)

    def find_timers(self):
        for block in self.iter_blocks():
            for t in block.timer:
                self.dump_node(block, t.pos)


if __name__ == "__main__":
    call = sys.argv[0]
    a = argparse.ArgumentParser(description='luanti map v29 inspection tool'
    , formatter_class=argparse.RawDescriptionHelpFormatter
    , epilog= f"""samples:
     $ {call} --node mcl_chests:chest_small -- ~/.minetest/worlds/mcl-test/map.sqlite
     $ {call} --node mcl_mobspawners:spawner -- ~/.minetest/worlds/mcl-test/map.sqlite
     $ {call} --spawners mobs_mc:skeleton -- ~/.minetest/worlds/mcl-test/map.sqlite
     $ {call} --item mcl_nether:netherite_upgrade_template -- ~/.minetest/worlds/mcl-test/map.sqlite
     $ {call} --object mcl_minecarts:minecart -- ~/.minetest/worlds/mcl-test/map.sqlite
    """)
    a.add_argument('-v', '--verbose', action='store_true', help="show info messages")
    a.add_argument('-d', '--debug', action='store_true', help="show debug and info messages")
    a.add_argument('--json', action='store_true', help="generate JSON output")
    a.add_argument('--radius', default=0, type=int, help=f"search radius in MapBlocks(1 = {MAP_BLOCKSIZE} nodes")

    a.add_argument('map_sqlite', help="path to 'map.sqlite'")
    a.add_argument('node_pos', nargs='*', help="node position(s) (i.e.: 0,0,0)")

    g = a.add_argument_group("query options")
    x = g.add_mutually_exclusive_group()
    x.add_argument('--spawners', help="find neighboring spawners")
    x.add_argument('--node', nargs='+', help="find node by name regex")
    x.add_argument('--item', help="find item by name")
    x.add_argument('--object', help="find object by name")
    x.add_argument('--timers', action='store_true', help="list node timers")
    args = a.parse_args()

    if args.debug:
        logging.basicConfig(level=logging.DEBUG)
    elif args.verbose:
        logging.basicConfig(level=logging.INFO)

    data = {}
    if args.json:
        def dumper(o):
            data.update(strip_null(o))

    map = Map(args.map_sqlite, args)

    if args.spawners:
        if args.spawners.startswith("mcl_") or args.spawners.startswith("mobs_mc"):
            map.find_neighbor_node("mcl_mobspawners:spawner", "Mob", args.spawners)
        else:
            def cb_value(value):
                return value.split(" ")[0] == args.spawners
            map.find_neighbor_node("mobs:spawner", "command", cb_value)
    elif args.node:
        map.find_node(args.node)
    elif args.item:
        map.find_item(args.item)
    elif args.object:
        map.find_object(args.object)
    elif args.timers:
        map.find_timers()
    else:
        #map.get_block_pos_stat()
        map.print_block_stat(use_dumper = args.json)

    if args.json:
        print(json.dumps(data, indent = 4))
    else:
        map.visualize()
