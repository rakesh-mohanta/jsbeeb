function Teletext() {
    "use strict";
    var self = this;

    self.chars = new Uint8Array(96 * 160);
    self.charsi = new Uint8Array(96 * 160);
    self.graph = new Uint8Array(96 * 160);
    self.graphi = new Uint8Array(96 * 160);
    self.sepgraph = new Uint8Array(96 * 160);
    self.sepgraphi = new Uint8Array(96 * 160);

    function init() {
        var Data = teletextCharacters();
        var i, x, x2, stat, offs1, offs2, j, y, o, p;
        // turn the 1s into 15s (?)
        for (i = 0; i < 96*60; ++i) {
            Data.normal[i] *= 15;
            Data.graphics[i] *= 15;
            Data.separated[i] *= 15;
        }
        // Double width for antialiasing.
        var tempi2 = new Uint8Array(96*120);
        for (i = 0; i < 96 * 120; ++i)
            tempi2[i] = Data.normal[i>>>1];
        var tempi = new Uint8Array(96*120);

        function lerp(a, b, x) {
            return a * (1-x) + b * x;
        }

        offs1 = offs2 = 0;
        for (i = 0; i < 960; ++i) {
            x = x2 = 0;
            for (j = 0; j < 16; ++j) {
                o = offs2 + j;
                //var p = offs1 + x2;
                //self.graph[o] = lerp(Data.graphics[p], Data.graphics[p + 1], x);
                //self.sepgraph[o] = lerp(Data.separated[p], Data.separated[p + 1], x);
                if (!j) {
                    self.graph[o] = self.graphi[o] = Data.graphics[offs1];
                    self.sepgraph[o] = self.sepgraphi[o] = Data.separated[offs1];
                } else if (j == 15) {
                    self.graph[o] = self.graphi[o] = Data.graphics[offs1 + 5];
                    self.sepgraph[o] = self.sepgraphi[o] = Data.separated[offs1 + 5];
                } else {
                    self.graph[o] = self.graphi[o] = Data.graphics[offs1 + x2];
                    self.sepgraph[o] = self.sepgraphi[o] = Data.separated[offs1 + x2];
                }
                x += 5/15;
                if (x >= 1) { x2++; x -= 1; }
                self.charsi[o] = 0;
            }
            offs1 += 6;
            offs2 += 16;
        }

        offs1 = offs2 = 0;
        for (i = 0; i < 96; ++i) {
            for (y = 0; y < 10; ++y) {
                for (x = 0; x < 6; ++x) {
                    stat = 0;
                    if (y != 9) {
                        var above = Data.normal[offs1 + y*6 + x];
                        var below = Data.normal[offs1 + y*6 + x + 6];
                        var left = Data.normal[offs1 + y*6 + x - 1];
                        var right = Data.normal[offs1 + y*6 + x + 1];
                        var belowLeft = Data.normal[offs1 + y*6 + x + 5];
                        var belowRight = Data.normal[offs1 + y*6 + x + 7];
                        if (above && below) stat = 3;
                        if (x>0 && above && belowLeft && !left) stat |= 1;
                        if (x>0 && below && left && !belowLeft) stat |= 1;
                        if (x<5 && above && belowRight && !right) stat |= 2;
                        if (x<6 && below && right && !belowRight) stat |= 2;
                    }
                    tempi[offs2] = (stat & 1) ? 15 : 0;
                    tempi[offs2 + 1] = (stat & 2) ? 15 : 0;
                    offs2 += 2;
                }
            }
            offs1 += 60;
        }

        offs1 = offs2 = 0;
        for (i = 0; i < 960; ++i) {
            x = x2 = 0;
            for (j = 0; j < 16; ++j) {
                o = offs2 + j;
                p = offs1 + x2;
                self.chars[o] = lerp(tempi2[p], tempi2[p + 1], x);
                self.charsi[o] = lerp(tempi[p], tempi[p + 1], x);
                x += 11/15;
                if (x >= 1) { x2++; x -= 1; }
                if (i >= 320 && i < 640) {
                    self.graph[o] = self.sepgraph[o] = self.chars[o];
                    self.graphi[o] = self.sepgraphi[o] = self.charsi[o];
                }
            }
            offs1 += 12;
            offs2 += 16;
        }

        function B(x) { x*= 255/15; if (x < 0) return 0; if (x > 255) return 255; return x|0; }
        self.palette = [];
        for (i = 0; i < 64; ++i) {
            self.palette[i] = new Uint32Array(16);
            for (var c = 0; c < 16; ++c) {
                var r = ((i&1)>>0) * c + ((i&8)>>3) * (15-c);
                var g = ((i&2)>>1) * c + ((i&16)>>4) * (15-c);
                var b = ((i&4)>>2) * c + ((i&32)>>5) * (15-c);
                self.palette[i][c] = 0xff000000 | (B(b)<<16) | (B(g)<<8) | (B(r)<<0);
            }
        }

        self.col = 7;
        self.bg = 0;
        self.sep = 0;
        self.dbl = self.oldDbl = self.nextDbl = self.wasDbl = false;
        self.gfx = 0;
        self.flash = self.flashOn = false;
        self.flashTime = 0;
        self.heldChar = self.holdChar = 0;
        self.curChars = [self.chars, self.charsi];
    }

    function handleControlCode(data) {
        // TODO: these need to be "exported" somehow to the caller
        var holdclear = false;
        var holdoff = false;
        switch (data) {
        case 1: case 2: case 3: case 4: case 5: case 6: case 7:
            self.gfx = 0;
            self.col = data;
            self.curChars[0] = self.chars;
            self.curChars[1] = self.charsi;
            holdclear = true;
            break;
        case 8: self.flash = true; break;
        case 9: self.flash = false; break;
        case 12: case 13:
            self.dbl = !!(data & 1);
            if (self.dbl) self.wasDbl = true;
            break;
        case 17: case 18: case 19: case 20: case 21: case 22: case 23:
            self.gfx = true;
            self.col = data & 7;
            if (self.sep) {
                self.curChars[0] = self.sepgraph;
                self.curChars[1] = self.sepgraphi;
            } else {
                self.curChars[0] = self.graph;
                self.curChars[1] = self.graphi;
            }
            break;
        case 24: 
            // TODO mcolx?
            self.col = self.bg;
            break;
        case 25:
            if (self.gfx) {
                self.curChars[0] = self.graph;
                self.curChars[1] = self.graphi;
            }
            self.sep = false;
            break;
        case 26:
            if (self.gfx) {
                self.curChars[0] = self.sepgraph;
                self.curChars[1] = self.sepgraphi;
            }
            self.sep = true;
            break;
        case 28: self.bg = 0; break;
        case 29: self.bg = self.col; break;
        case 30: self.holdChar = true; break;
        case 31: holdoff = true; break;
        }
        if (self.holdChar) {
            data = self.heldChar;
            if (data >= 0x40 && data <= 0x60) data = 0x20;
            // TODO held 'px'
        } else data = 0x20;
        if (self.dbl !== self.oldDbl) data = 0x20; 
        return data;
    }

    function render(buf, offset, scanline, data) {
        var i;
        self.oldDbl = self.dbl;
        if (data == 255) {
            for (i = 0; i < 16; ++i) {
                buf[offset + i + 16] = 0xff000000; // todo color lookup 0
            }
            return;
        }
        var prevFlash = self.flash;
        if (data < 0x20) data = handleControlCode(data);
        var t = (data - 0x20) * 160;
        if (self.oldDbl) {
            t += (scanline >>> 1) * 16;
            if (self.nextDbl) t += 5*16;
        } else {
            t += scanline * 16;
        }
            
        var palette;
        if (prevFlash && self.flashOn) {
            palette = self.palette[0];
        } else if (!self.dbl && self.nextDbl) {
            palette = self.palette[((self.bg & 7)<<3) | (self.bg & 7)];
        } else {
            palette = self.palette[((self.bg & 7)<<3) | (self.col & 7)];
        }
        var px = self.curChars[0];
        // TODO interlace
        offset += 16; // TODO: why is this needed?
        // Unrolling seems a good thing here, at least on Chrome.
        buf[offset++] = palette[px[t++]];
        buf[offset++] = palette[px[t++]];
        buf[offset++] = palette[px[t++]];
        buf[offset++] = palette[px[t++]];
        buf[offset++] = palette[px[t++]];
        buf[offset++] = palette[px[t++]];
        buf[offset++] = palette[px[t++]];
        buf[offset++] = palette[px[t++]];
        buf[offset++] = palette[px[t++]];
        buf[offset++] = palette[px[t++]];
        buf[offset++] = palette[px[t++]];
        buf[offset++] = palette[px[t++]];
        buf[offset++] = palette[px[t++]];
        buf[offset++] = palette[px[t++]];
        buf[offset++] = palette[px[t++]];
        buf[offset++] = palette[px[t++]];
    }

    this.verticalCharEnd = function() {
        if (self.nextDbl) 
            self.nextDbl = false;
        else
            self.nextDbl = self.wasDbl;
    };

    this.vsync = function() {
        if (++self.flashTime == 48) self.flashTime = 0;
        self.flashOn = self.flashTime < 16;
    };

    this.endline = function() {
        self.col = 7;
        self.bg = 0;
        self.holdChar = false;
        self.heldChar = 0x20;
        self.curChars[0] = self.chars;
        self.curChars[1] = self.charsi;
        self.flash = false;
        self.sep = false;
        self.gfx = false;
        // TODO heldp

        self.dbl = self.wasDbl = false;
    };

    this.render = render;

    init();
}
