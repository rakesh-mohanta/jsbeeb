function rotate(left, logical) {
    "use strict";
    var lines = [];
    if (!left) {
        if (!logical) lines.push("var newTopBit = cpu.p.c ? 0x80 : 0x00;");
        lines.push("cpu.p.c = !!(REG & 0x01);");
        if (logical) {
            lines.push("REG >>>= 1;");
        } else {
            lines.push("REG = (REG >>> 1) | newTopBit;");
        }
    } else {
        if (!logical) lines.push("var newBotBit = cpu.p.c ? 0x01 : 0x00;");
        lines.push("cpu.p.c = !!(REG & 0x80);");
        if (logical) {
            lines.push("REG = (REG << 1) & 0xff;");
        } else {
            lines.push("REG = ((REG << 1) & 0xff) | newBotBit;");
        }
    }
    lines.push("cpu.setzn(REG);");
    return lines;
}

function pull(reg) {
    "use strict";
    if (reg == 'p') {
        return [
                "var tempFlags = cpu.pull();",
                "cpu.p.c = !!(tempFlags & 0x01);",
                "cpu.p.z = !!(tempFlags & 0x02);",
                "cpu.p.i = !!(tempFlags & 0x04);",
                "cpu.p.d = !!(tempFlags & 0x08);",
                "cpu.p.v = !!(tempFlags & 0x40);",
                "cpu.p.n = !!(tempFlags & 0x80);"
                    ];
    }
    return ["cpu." + reg + " = cpu.pull();", "cpu.setzn(cpu." + reg + ")"];
}

function push(reg) {
    "use strict";
    if (reg == 'p') return "cpu.push(cpu.p.asByte());";
    return "cpu.push(cpu." + reg + ");";
}

function InstructionGen() {
    "use strict";
    var self = this;
    self.ops = {};
    self.cycle = 0;

    self.flush = function() {
        self.append(self.cycle, "", true);
    };

    function appendOrPrepend(combiner, cycle, op, exact, addr) {
        if (op === undefined) {
            op = cycle;
            cycle = self.cycle;
        }
        exact = exact || false;
        if (typeof(op) == "string") op = [op];
        if (self.ops[cycle])  {
            self.ops[cycle].op = combiner(self.ops[cycle].op, op);
            self.ops[cycle].exact |= exact;
            if (!self.ops[cycle].addr) self.ops[cycle].addr = addr;
        } else
            self.ops[cycle] = {op: op, exact: exact, addr: addr };
    }

    self.append = function(cycle, op, exact, addr) {
        appendOrPrepend(function(lhs, rhs) { return lhs.concat(rhs); }, cycle, op, exact, addr);
    };
    self.prepend = function(cycle, op, exact, addr) {
        appendOrPrepend(function(lhs, rhs) { return rhs.concat(lhs); }, cycle, op, exact, addr);
    };

    self.tick = function(cycles) { self.cycle += (cycles || 1); };
    self.readOp = function(addr, reg) {
        self.cycle++;
        var op;
        if (reg)
            op = reg + " = cpu.readmem(" + addr + ");";
        else
            op = "cpu.readmem(" + addr + ");";
        self.append(self.cycle, op, true, addr);
    };
    self.writeOp = function(addr, reg) {
        self.cycle++;
        self.append(self.cycle, "cpu.writemem(" + addr + ", " + reg + ");", true, addr);
    };
    self.zpReadOp = function(addr, reg) {
        self.cycle++;
        self.append(self.cycle, reg + " = cpu.readmemZpStack(" + addr + ");", false);
    };
    self.zpWriteOp = function(addr, reg) {
        self.cycle++;
        self.append(self.cycle, "cpu.writememZpStack(" + addr + ", " + reg + ");", true);
    };
    self.render = function() {
        if (self.cycle < 2) self.cycle = 2;
        self.prepend(self.cycle - 1, "cpu.checkInt();", true);
        var i;
        var toSkip = 0;
        var out = [];
        for (i = 0; i < self.cycle; ++i) {
            if (!self.ops[i]) {
                toSkip++;
                continue;
            }
            if (toSkip && self.ops[i].exact) {
                if (self.ops[i].addr) {
                    out.push("cpu.polltime(" + toSkip + "+ cpu.is1MHzAccess(" + self.ops[i].addr + ") * (" + ((toSkip & 1) ? "!" : "") + "(cpu.cycles & 1) + 1));");
                } else {
                    out.push("cpu.polltime(" + toSkip + ");");
                }
                toSkip = 0;
            }
            out = out.concat(self.ops[i].op);
            toSkip++;
        }
        if (toSkip) {
            if (self.ops[self.cycle].addr) {
                out.push("cpu.polltime(" + toSkip + "+ cpu.is1MHzAccess(" + self.ops[self.cycle].addr + ") * (" + ((toSkip & 1) ? "!" : "") + "(cpu.cycles & 1) + 1));");            
            } else {
                out.push("cpu.polltime(" + toSkip + ");");
            }
        }
        if (self.ops[self.cycle]) out = out.concat(self.ops[self.cycle].op);
        return out.filter(function(l){return l;});
    };
}

function getOp(op) {
    "use strict";
    switch (op) {
    case "NOP": return { op: "" };
    case "BRK": return { op: "cpu.brk();", extra: 6 };
    case "CLC": return { op: "cpu.p.c = false;" };
    case "SEC": return { op: "cpu.p.c = true;" };
    case "CLD": return { op: "cpu.p.d = false;" };
    case "SED": return { op: "cpu.p.d = true;" };
    case "CLI": return { op: "cpu.p.i = false;" };
    case "SEI": return { op: "cpu.p.i = true;" };
    case "CLV": return { op: "cpu.p.v = false;" };
    case "LDA": return { op: ["cpu.a = REG;", "cpu.setzn(cpu.a);"], read: true };
    case "LDX": return { op: ["cpu.x = REG;", "cpu.setzn(cpu.x);"], read: true };
    case "LDY": return { op: ["cpu.y = REG;", "cpu.setzn(cpu.y);"], read: true };
    case "STA": return { op: "REG = cpu.a;", write: true };
    case "STX": return { op: "REG = cpu.x;", write: true };
    case "STY": return { op: "REG = cpu.y;", write: true };
    case "INC": return { 
        op: ["REG = (REG + 1) & 0xff;", "cpu.setzn(REG);"], 
        read: true, write: true 
    };
    case "DEC": return { 
        op: ["REG = (REG - 1) & 0xff;", "cpu.setzn(REG);"], 
        read: true, write: true 
    };
    case "INX": return { op: ["cpu.x = (cpu.x + 1) & 0xff;", "cpu.setzn(cpu.x);"] };
    case "INY": return { op: ["cpu.y = (cpu.y + 1) & 0xff;", "cpu.setzn(cpu.y);"] };
    case "DEX": return { op: ["cpu.x = (cpu.x - 1) & 0xff;", "cpu.setzn(cpu.x);"] };
    case "DEY": return { op: ["cpu.y = (cpu.y - 1) & 0xff;", "cpu.setzn(cpu.y);"] };
    case "ADC": return { op: "cpu.adc(REG);", read: true };
    case "SBC": return { op: "cpu.sbc(REG);", read: true };
    case "BIT": return {
        op: [
            "cpu.p.z = !(cpu.a & REG);",
            "cpu.p.v = !!(REG & 0x40);",
            "cpu.p.n = !!(REG & 0x80);"],
        read: true };
    case "ROL": return { op: rotate(true, false), read: true, write: true };
    case "ROR": return { op: rotate(false, false), read: true, write: true };
    case "ASL": return { op: rotate(true, true), read: true, write: true };
    case "LSR": return { op: rotate(false, true), read: true, write: true };
    case "EOR": return { op: ["cpu.a = (cpu.a ^ REG) & 0xff;", "cpu.setzn(cpu.a);"], read: true };
    case "AND": return { op: ["cpu.a = (cpu.a & REG) & 0xff;", "cpu.setzn(cpu.a);"], read: true };
    case "ORA": return { op: ["cpu.a = (cpu.a | REG) & 0xff;", "cpu.setzn(cpu.a);"], read: true };
    case "CMP": return { op: ["cpu.setzn(cpu.a - REG);", "cpu.p.c = cpu.a >= REG;"], 
        read: true };
    case "CPX": return { op: ["cpu.setzn(cpu.x - REG);", "cpu.p.c = cpu.x >= REG;"], 
        read: true };
    case "CPY": return { op: ["cpu.setzn(cpu.y - REG);", "cpu.p.c = cpu.y >= REG;"], 
        read: true };
    case "TXA": return { op: ["cpu.a = cpu.x;", "cpu.setzn(cpu.a);"] };
    case "TAX": return { op: ["cpu.x = cpu.a;", "cpu.setzn(cpu.x);"] };
    case "TXS": return { op: "cpu.s = cpu.x;" };
    case "TSX": return { op: ["cpu.x = cpu.s;", "cpu.setzn(cpu.x);"] };
    case "TYA": return { op: ["cpu.a = cpu.y;", "cpu.setzn(cpu.a);"] };
    case "TAY": return { op: ["cpu.y = cpu.a;", "cpu.setzn(cpu.y);"] };
    case "BEQ": return { op: "cpu.branch(cpu.p.z);" };
    case "BNE": return { op: "cpu.branch(!cpu.p.z);" };
    case "BCS": return { op: "cpu.branch(cpu.p.c);" };
    case "BCC": return { op: "cpu.branch(!cpu.p.c);" };
    case "BMI": return { op: "cpu.branch(cpu.p.n);" };
    case "BPL": return { op: "cpu.branch(!cpu.p.n);" };
    case "BVS": return { op: "cpu.branch(cpu.p.v);" };
    case "BVC": return { op: "cpu.branch(!cpu.p.v);" };
    case "PLA": return { op: pull('a'), extra: 3 };
    case "PLP": return { op: pull('p'), extra: 3 };
    case "PLX": return { op: pull('x'), extra: 3 };
    case "PLY": return { op: pull('y'), extra: 3 };
    case "PHA": return { op: push('a'), extra: 2 };
    case "PHP": return { op: push('p'), extra: 2 };
    case "PHX": return { op: push('x'), extra: 2 };
    case "PHY": return { op: push('y'), extra: 2 };
    case "RTS": return { op: [  // TODO: check in v6502
        "var temp = cpu.pull();",
        "temp |= cpu.pull() << 8;",
        "cpu.pc = (temp + 1) & 0xffff;" ], extra: 5 };
    case "RTI": return { preop: [  // TODO: check in v6502
        "var temp = cpu.pull();",
        "cpu.p.c = !!(temp & 0x01);",
        "cpu.p.z = !!(temp & 0x02);",
        "cpu.p.i = !!(temp & 0x04);",
        "cpu.p.d = !!(temp & 0x08);",
        "cpu.p.v = !!(temp & 0x40);",
        "cpu.p.n = !!(temp & 0x80);",
        "temp = cpu.pull();",
        "cpu.pc = temp | (cpu.pull() << 8);" ], extra: 5 };
    case "JSR": return { op: [
        "var pushAddr = cpu.pc - 1;",
        "cpu.push(pushAddr >> 8);",
        "cpu.push(pushAddr & 0xff);",
        "cpu.pc = addr;" ], extra: 3 };
    case "JMP": return { op: "cpu.pc = addr;" };

    // Undocumented opcodes
    case "SAX": return { op: "REG = cpu.a & cpu.x;", write: true };
    case "ASR": return { op: ["REG &= cpu.a;"].concat(
                        rotate(false, false)).concat(["cpu.a = REG;"])};
    case "SLO": return { op: rotate(true, false).concat([
        // TODO timings are off here, and (ab)uses fact there's going to be an 'addr' variable
        "cpu.writemem(addr, REG);", 
        "cpu.a |= REG;",
        "cpu.setzn(cpu.a);"
        ]), read: true, write: true };
    }
    return null;
}

function getInstruction(opcodeString, needsReg) {
    "use strict";
    var split = opcodeString.split(' ');
    var opcode = split[0];
    var arg = split[1];
    var op = getOp(opcode);
    if (!op) return null;

    var ig = new InstructionGen();
    if (needsReg) ig.append("var REG = 0|0;");

    switch (arg) {
    case undefined:
        // Many of these ops need a little special casing.
        if (op.read || op.write) throw "Unsupported " + opcodeString;
        ig.append(op.preop);
        ig.tick(Math.max(2, 1 + (op.extra || 0)));
        ig.flush();
        ig.append(op.op);
        return ig.render();

    case "branch":
        return [op.op];  // TODO: special cased here, would be nice to pull out of cpu

    case "zp":
    case "zp,x":
    case "zp,y":
        if (arg == "zp") {
            ig.tick(2);
            ig.append("var addr = cpu.getb();");
        } else {
            ig.tick(3);
            ig.append("var addr = (cpu.getb() + cpu." + arg[3] + ") & 0xff;");
        }
        if (op.read) {
            ig.zpReadOp("addr", "REG");
            if (op.write) {
                ig.flush();
                ig.tick(1);  // Spurious write
            }
        }
        ig.append(op.op);
        if (op.write) ig.zpWriteOp("addr", "REG");
        return ig.render();

    case "abs":
        ig.tick(3 + (op.extra || 0));
        ig.append("var addr = cpu.getw();");
        if (op.read) {
            ig.readOp("addr", "REG");
            if (op.write) ig.writeOp("addr", "REG");
        }
        ig.append(op.op);
        if (op.write) ig.writeOp("addr", "REG");

        return ig.render();

    case "abs,x":
    case "abs,y":
        ig.tick(3);
        ig.append("var addr = cpu.getw();");
        ig.append("var addrWithCarry = (addr + cpu." + arg[4] + ") & 0xffff;");
        ig.append("var addrNonCarry = (addr & 0xff00) | (addrWithCarry & 0xff);");
        if (op.read) {
            if (!op.write) {
                // For non-RMW, we only pay the cost of the spurious read if the address carried
                ig.append("if (addrWithCarry !== addrNonCarry) {");
                ig.append("    cpu.polltime(1);");
                ig.append("    REG = cpu.readmem(addrNonCarry);");
                ig.append("}");
                ig.flush();
                ig.readOp("addrWithCarry", "REG");
            } else {
                // For RMW we always have a spurious read and then a spurious write
                ig.readOp("addrNonCarry");
                ig.readOp("addrWithCarry", "REG");
                ig.writeOp("addrWithCarry", "REG");
            }
        } else if (op.write) {
            // Pure stores still exhibit a read at the non-carried address.
            ig.readOp("addrNonCarry");
        }
        ig.append(op.op);
        if (op.write) {
            ig.writeOp("addrWithCarry", "REG");
        }
        return ig.render();

    case "imm":
        if (op.write) {
            throw "This isn't possible";
        }
        if (op.read) {
            // NOP imm
        }
        ig.tick(2);
        ig.append("REG = cpu.getb();");
        ig.append(op.op);
        return ig.render();

    case "A":
        ig.tick(2);
        ig.append("REG = cpu.a;");
        ig.append(op.op);
        ig.append("cpu.a = REG;");
        return ig.render();

    case "(,x)":
    case "(,y)":
        ig.tick(3); // two, plus one for the seemingly spurious extra read of zp
        ig.append("var zpAddr = (cpu.getb() + cpu." + arg[2] + ") & 0xff;");
        ig.append("var lo, hi;");
        ig.zpReadOp("zpAddr", "lo");
        ig.zpReadOp("(zpAddr + 1) & 0xff", "hi");
        ig.append("var addr = lo | (hi << 8);");
        if (op.read) ig.readOp("addr", "REG");
        ig.append(op.op);
        if (op.write) ig.writeOp("addr", "REG");
        return ig.render();

    case "(),y":
        ig.tick(2);
        ig.append("var zpAddr = cpu.getb();");
        ig.append("var lo, hi;");
        ig.zpReadOp("zpAddr", "lo");
        ig.zpReadOp("(zpAddr + 1) & 0xff", "hi");
        ig.append("var addr = lo | (hi << 8);");
        ig.append("var addrWithCarry = (addr + cpu.y) & 0xffff;");
        ig.append("var addrNonCarry = (addr & 0xff00) | (addrWithCarry & 0xff);");
        // Strictly speaking this code below is overkill; it handles RMW when no such documented
        // instruction exists.
        if (op.read) {
            if (!op.write) {
                // For non-RMW, we only pay the cost of the spurious read if the address carried
                ig.flush();
                ig.append("if (addrWithCarry !== addrNonCarry) {");
                ig.append("    cpu.polltime(1);");
                ig.append("    REG = cpu.readmem(addrNonCarry);");
                ig.append("}");
                ig.readOp("addrWithCarry", "REG");
            } else {
                // For RMW we always have a spurious read and then a spurious write
                ig.readOp("addrNonCarry");
                ig.readOp("addrWithCarry", "REG");
                ig.writeOp("addrWithCarry", "REG");
            }
        } else if (op.write) {
            // Pure stores still exhibit a read at the non-carried address.
            ig.readOp("addrNonCarry");
        }
        ig.append(op.op);
        if (op.write) ig.writeOp("addrWithCarry", "REG");
        return ig.render();

    case "()": 
        // Special case for indirect jumps only
        ig.tick(3);  // Needs to be different for master
        ig.append("var addr = cpu.getw();");
        ig.append("var nextAddr = ((addr + 1) & 0xff) | (addr & 0xff00);");
        ig.append("var lo, hi;");
        ig.readOp("addr", "lo");
        ig.readOp("nextAddr", "hi");
        ig.append("addr = lo | (hi << 8);");
        ig.append(op.op);
        return ig.render();

    case "zpx":
        return null;

    default:
        throw "Unknown arg type " + arg;
    }
    return null;
}

function compileInstruction(ins) {
    "use strict";
    var lines = getInstruction(ins, true);
    if (!lines) return null;
    var funcName = ins.replace(" ", "_").replace("()", "ind").replace(",", "_").replace("(", "").replace(")", "");
    var text = "var " + funcName + " = function(cpu) {   // " + ins +
        "\n    \"use strict\";\n    " + lines.join("\n    ") + "\n}\n;" +
        funcName + "\n";
    try {
        return eval(text); // jshint ignore:line
    } catch (e) {
        throw "Unable to compile: " + e + "\nText:\n" + text;
    }
}

var opcodes6502 = {
    0x00: "BRK",
    0x01: "ORA (,x)",
    0x03: "SLO (,x)",
    0x04: "NOP zp",
    0x05: "ORA zp",
    0x06: "ASL zp",
    0x07: "SLO zp",
    0x08: "PHP",
    0x09: "ORA imm",
    0x0A: "ASL A",
    0x0B: "ANC imm",
    0x0C: "NOP abs",
    0x0D: "ORA abs",
    0x0E: "ASL abs",
    0x0F: "SLO abs",
    0x10: "BPL branch",
    0x11: "ORA (),y",
    0x13: "SLO (),y",
    0x14: "NOP zp,x",
    0x15: "ORA zp,x",
    0x16: "ASL zp,x",
    0x17: "SLO zp,x",
    0x18: "CLC",
    0x19: "ORA abs,y",
    0x1A: "NOP",
    0x1B: "SLO abs,y",
    0x1C: "NOP abs,x",
    0x1D: "ORA abs,x",
    0x1E: "ASL abs,x",
    0x1F: "SLO abs,x",
    0x20: "JSR abs",
    0x21: "AND (,x)",
    0x23: "RLA (,x)",
    0x24: "BIT zp",
    0x25: "AND zp",
    0x26: "ROL zp",
    0x27: "RLA zp",
    0x28: "PLP",
    0x29: "AND imm",
    0x2A: "ROL A",
    0x2B: "ANC imm",
    0x2C: "BIT abs",
    0x2D: "AND abs",
    0x2E: "ROL abs",
    0x2F: "RLA abs",
    0x30: "BMI branch",
    0x31: "AND (),y",
    0x33: "RLA (),y",
    0x34: "NOP zp,x",
    0x35: "AND zp,x",
    0x36: "ROL zp,x",
    0x37: "RLA zp,x",
    0x38: "SEC",
    0x39: "AND abs,y",
    0x3A: "NOP",
    0x3B: "RLA abs,y",
    0x3C: "NOP abs,x",
    0x3D: "AND abs,x",
    0x3E: "ROL abs,x",
    0x3F: "RLA abs,x",
    0x40: "RTI",
    0x41: "EOR (,x)",
    0x43: "SRE (,x)",
    0x44: "NOP zp",
    0x45: "EOR zp",
    0x46: "LSR zp",
    0x47: "SRE zp",
    0x48: "PHA",
    0x49: "EOR imm",
    0x4A: "LSR A",
    0x4B: "ASR imm",
    0x4C: "JMP abs",
    0x4D: "EOR abs",
    0x4E: "LSR abs",
    0x4F: "SRE abs",
    0x50: "BVC branch",
    0x51: "EOR (),y",
    0x53: "SRE (),y",
    0x54: "NOP zp,x",
    0x55: "EOR zp,x",
    0x56: "LSR zp,x",
    0x57: "SRE zp,x",
    0x58: "CLI",
    0x59: "EOR abs,y",
    0x5A: "NOP",
    0x5B: "SRE abs,y",
    0x5C: "NOP abs,x",
    0x5D: "EOR abs,x",
    0x5E: "LSR abs,x",
    0x5F: "SRE abs,x",
    0x60: "RTS",
    0x61: "ADC (,x)",
    0x63: "RRA (,x)",
    0x64: "NOP zp",
    0x65: "ADC zp",
    0x66: "ROR zp",
    0x67: "RRA zp",
    0x68: "PLA",
    0x69: "ADC imm",
    0x6A: "ROR A",
    0x6B: "ARR",
    0x6C: "JMP ()",
    0x6D: "ADC abs",
    0x6E: "ROR abs",
    0x6F: "RRA abs",
    0x70: "BVS branch",
    0x71: "ADC (),y",
    0x73: "RRA (,y)",
    0x74: "NOP zp,x",
    0x75: "ADC zp,x",
    0x76: "ROR zp,x",
    0x77: "RRA zp,x",
    0x78: "SEI",
    0x79: "ADC abs,y",
    0x7A: "NOP",
    0x7B: "RRA abs,y",
    0x7D: "ADC abs,x",
    0x7E: "ROR abs,x",
    0x7F: "RRA abs,x",
    0x80: "NOP imm",
    0x81: "STA (,x)",
    0x82: "NOP imm",
    0x83: "SAX (,x)",
    0x84: "STY zp",
    0x85: "STA zp",
    0x86: "STX zp",
    0x87: "SAX zp",
    0x88: "DEY",
    0x89: "NOP imm",
    0x8A: "TXA",
    0x8B: "ANE",
    0x8C: "STY abs",
    0x8D: "STA abs",
    0x8E: "STX abs",
    0x8F: "SAX abs",
    0x90: "BCC branch",
    0x91: "STA (),y",
    0x93: "SHA (),y",
    0x94: "STY zp,x",
    0x95: "STA zp,x",
    0x96: "STX zp,y",
    0x97: "SAX zp,y",
    0x98: "TYA",
    0x99: "STA abs,y",
    0x9A: "TXS",
    0x9B: "SHS abs,y",
    0x9C: "SHY abs,x",
    0x9D: "STA abs,x",
    0x9E: "SHX abs,y",
    0x9F: "SHA abs,y",
    0xA0: "LDY imm",
    0xA1: "LDA (,x)",
    0xA2: "LDX imm",
    0xA3: "LAX (,y)",
    0xA4: "LDY zp",
    0xA5: "LDA zp",
    0xA6: "LDX zp",
    0xA7: "LAX zp",
    0xA8: "TAY",
    0xA9: "LDA imm",
    0xAA: "TAX",
    0xAB: "LAX",
    0xAC: "LDY abs",
    0xAD: "LDA abs",
    0xAE: "LDX abs",
    0xAF: "LAX abs",
    0xB0: "BCS branch",
    0xB1: "LDA (),y",
    0xB3: "LAX (),y",
    0xB4: "LDY zp,x",
    0xB5: "LDA zp,x",
    0xB6: "LDX zp,y",
    0xB7: "LAX zp,y",
    0xB8: "CLV",
    0xB9: "LDA abs,y",
    0xBA: "TSX",
    0xBB: "LAS abs,y",
    0xBC: "LDY abs,x",
    0xBD: "LDA abs,x",
    0xBE: "LDX abs,y",
    0xBF: "LAX abs,y",
    0xC0: "CPY imm",
    0xC1: "CMP (,x)",
    0xC2: "NOP imm",
    0xC3: "DCP (,x)",
    0xC4: "CPY zp",
    0xC5: "CMP zp",
    0xC6: "DEC zp",
    0xC7: "DCP zp",
    0xC8: "INY",
    0xC9: "CMP imm",
    0xCA: "DEX",
    0xCB: "SBX imm",
    0xCC: "CPY abs",
    0xCD: "CMP abs",
    0xCE: "DEC abs",
    0xCF: "DCP abs",
    0xD0: "BNE branch",
    0xD1: "CMP (),y",
    0xD3: "DCP (),y",
    0xD4: "NOP zp,x",
    0xD5: "CMP zp,x",
    0xD6: "DEC zp,x",
    0xD7: "DCP zp,x",
    0xD8: "CLD",
    0xD9: "CMP abs,y",
    0xDA: "NOP",
    0xDB: "DCP abs,y",
    0xDC: "NOP abs,x",
    0xDD: "CMP abs,x",
    0xDE: "DEC abs,x",
    0xDF: "DCP abs,x",
    0xE0: "CPX imm",
    0xE1: "SBC (,x)",
    0xE2: "NOP imm",
    0xE3: "ISB (,x)",
    0xE4: "CPX zp",
    0xE5: "SBC zp",
    0xE6: "INC zp",
    0xE7: "ISB zp",
    0xE8: "INX",
    0xE9: "SBC imm",
    0xEA: "NOP",
    0xEB: "SBC imm",
    0xEC: "CPX abs",
    0xED: "SBC abs",
    0xEE: "INC abs",
    0xEF: "ISB abs",
    0xF0: "BEQ branch",
    0xF1: "SBC (),y",
    0xF3: "ISB (),y",
    0xF4: "NOP zpx",
    0xF5: "SBC zp,x",
    0xF6: "INC zp,x",
    0xF7: "ISB zp,x",
    0xF8: "SED",
    0xF9: "SBC abs,y",
    0xFA: "NOP",
    0xFB: "ISB abs,y",
    0xFC: "NOP abs,x",
    0xFD: "SBC abs,x",
    0xFE: "INC abs,x",
    0xFF: "ISB abs,x",
};

function generate6502() {
    "use strict";
    var functions = [];
    for (var i = 0; i < 256; ++i) {
        var opcode = opcodes6502[i];
        if (opcode) functions[i] = compileInstruction(opcode);
    }
    return functions;
}

function generate6502Switch(min, max) {
    "use strict";
    var text = "var emulate = function(cpu, opcode) {\n" +
        "    \"use strict\";\n    var REG = 0|0;\n    switch (opcode) {\n";
    for (var i = min; i < max; ++i) {
        var opcode = opcodes6502[i];
        if (opcode) {
            var lines = getInstruction(opcode, false);
            text += "    case " + i + ":\n        ";
            if (!lines) {
                text += "invalidOpcode(cpu, opcode);";
            } else {
                text += lines.join("\n        ");
            }
            text += "\n    break;\n";
        }
    }
    text += "    }\n\n}\n; emulate;";
    return eval(text);
}

function Disassemble6502(cpu) {
    "use strict";
    this.disassemble = function(addr) {
        var opcode = opcodes6502[cpu.readmem(addr)];
        if (!opcode) { return ["???", addr + 1]; }
        var split = opcode.split(" ");
        if (!split[1]) {
            return [opcode, addr + 1];
        }
        var param = split[1] || "";
        var suffix = "";
        var index = param.match(/(.*),([xy])$/);
        if (index) {
            param = index[1];
            suffix = "," + index[2].toUpperCase();
        }
        switch (param) {
        case "imm":
            return [split[0] + " #$" + hexbyte(cpu.readmem(addr + 1)) + suffix, addr + 2];
        case "abs":
            return [split[0] + " $" + hexword(cpu.readmem(addr + 1) | (cpu.readmem(addr+2)<<8)) + suffix,
                   addr + 3];
        case "branch":
            return [split[0] + " $" + hexword(addr + signExtend(cpu.readmem(addr + 1)) + 2) + suffix,
                   addr + 2];
        case "zp":
            return [split[0] + " $" + hexbyte(cpu.readmem(addr + 1)) + suffix, addr + 2];
        case "(,x)":
            return [split[0] + " ($" + hexbyte(cpu.readmem(addr + 1)) + ", X)" + suffix, addr + 2];
        case "()":
            if (split[0] == "JMP")
                return [split[0] + " ($" + hexword(cpu.readmem(addr + 1) | (cpu.readmem(addr+2)<<8)) + ")" + suffix,
                    addr + 3];
            else
                return [split[0] + " ($" + hexbyte(cpu.readmem(addr + 1)) + ")" + suffix, addr + 2];
        }
        return [opcode, addr + 1];
    };
}

function invalidOpcode(cpu, opcode) {
    console.log("Invalid opcode " + hexbyte(opcode) + " at " + hexword(cpu.pc));
    console.log(cpu.disassembler.disassemble(cpu.pc)[0]);
    noteEvent('exception', 'invalid opcode', hexbyte(opcode));
    stop(true);
}

var instructions6502 = generate6502();
function runInstructionOldWay(cpu, opcode) {  // Unused as of now. This way seems a tiny bit slower for Firefox
    var instruction = instructions6502[opcode];
    if (!instruction) {
        invalidOpcode(cpu, opcode);
        return;
    }
    instruction(cpu);
}

var lower128 = generate6502Switch(0, 128);
var upper128 = generate6502Switch(128, 256);

function runInstruction(cpu, opcode) {
    if (opcode < 128) lower128(cpu, opcode); else upper128(cpu, opcode);
}
