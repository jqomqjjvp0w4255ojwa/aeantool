// CharacterPanel.jsx — 角色快速綁定/動態面板 v2.0
//
// 安裝(建議,變成常駐面板):
//   把這個檔案放到 AE 安裝目錄的 Support Files\Scripts\ScriptUI Panels\
//   重開 AE 後,在 Window 選單最下面會出現「角色工具」
// 或臨時使用:File > Scripts > Run Script File...(會開成浮動視窗)
//
// 工作流:
//   1.(標記)點選圖層 → 按對應按鈕:自動改標準名 + 建 control + 掛切換表達式
//      勾「完整綁定」會順便建 face/eye/mouth/ear Null 並 parent
//   2.(一鍵動態)隨機眨眼 / 說話設定 / 呼吸 / 漂浮
//      → 只有閉眼或只有閉嘴的角色會自動改用「縮放擠壓」方案
//   3.(演出)聽到角色開口 → 停在那一格按「開始說話」,結束按「停止說話」
//      → 在 mouth 滑桿上打 HOLD key,切分鏡時邊聽邊點就好

(function (thisObj) {

    // ================= 共用 =================

    // 面板底部的狀態列(buildUI 會把它指過來)。
    // 重複性高的操作(呼吸/漂浮…)用這個顯示結果,不跳 alert 打斷操作。
    var statusLabel = null;
    function showStatus(msg) {
        if (statusLabel) {
            try { statusLabel.text = msg; return; } catch (e) {}
        }
        alert(msg);
    }

    // 拉桿輸入(取代 prompt):回傳整數,取消回傳 null
    function promptSlider(title, label, value, min, max) {
        var d = new Window("dialog", title);
        d.orientation = "column";
        d.alignChildren = ["fill", "top"];
        var g = d.add("group");
        g.add("statictext", undefined, label);
        var valText = g.add("statictext", undefined, String(Math.round(value)));
        valText.preferredSize.width = 36;
        var sl = d.add("slider", undefined, value, min, max);
        sl.preferredSize.width = 240;
        sl.onChanging = function () { valText.text = String(Math.round(sl.value)); };
        var btns = d.add("group");
        btns.alignment = "right";
        var ok = btns.add("button", undefined, "OK", { name: "ok" });
        var cancel = btns.add("button", undefined, "取消", { name: "cancel" });
        var result = null;
        ok.onClick = function () { result = Math.round(sl.value); d.close(); };
        cancel.onClick = function () { d.close(); };
        d.show();
        return result;
    }

    // 數字輸入 + / − 微調(取代 prompt):回傳數字,取消回傳 null
    function promptStepper(title, label, value, step) {
        var d = new Window("dialog", title);
        d.orientation = "column";
        d.alignChildren = ["fill", "top"];
        d.add("statictext", undefined, label);
        var g = d.add("group");
        var et = g.add("edittext", undefined, String(value)); et.preferredSize.width = 60;
        var spin = g.add("group");
        spin.orientation = "column";
        spin.spacing = 0;
        var up = spin.add("button", undefined, "▲"); up.preferredSize.width = 22; up.preferredSize.height = 11;
        var down = spin.add("button", undefined, "▼"); down.preferredSize.width = 22; down.preferredSize.height = 11;
        up.onClick = function () {
            var v = parseFloat(et.text); if (isNaN(v)) v = value;
            et.text = String(Math.round((v + step) * 100) / 100);
        };
        down.onClick = function () {
            var v = parseFloat(et.text); if (isNaN(v)) v = value;
            et.text = String(Math.round((v - step) * 100) / 100);
        };
        var btns = d.add("group");
        btns.alignment = "right";
        var ok = btns.add("button", undefined, "OK", { name: "ok" });
        var cancel = btns.add("button", undefined, "取消", { name: "cancel" });
        var result = null;
        ok.onClick = function () {
            var v = parseFloat(et.text);
            if (!isNaN(v)) result = v;
            d.close();
        };
        cancel.onClick = function () { d.close(); };
        d.show();
        return result;
    }

    function activeComp() {
        var c = app.project.activeItem;
        if (!(c instanceof CompItem)) { alert("請先點一下要操作的合成時間軸。"); return null; }
        return c;
    }

    function findLayer(comp, name) {
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === name) return comp.layer(i);
        }
        return null;
    }

    // 從 comp 往內找到「含 control 的合成」,回傳 { comp, chain }。
    // chain 是從 comp 往內、一路到含 control 那層之間的圖層串(外→內),用來換算時間。
    // 角色結構常是:外層 → 角色precomp → 頭precomp(含 control),control 不在最外層,要往內挖。
    function findControlChain(comp, depthLimit) {
        if (findLayer(comp, "control")) return { comp: comp, chain: [] };
        if (depthLimit <= 0) return null;
        for (var i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            if (L.source instanceof CompItem) {
                var r = findControlChain(L.source, depthLimit - 1);
                if (r) return { comp: r.comp, chain: [L].concat(r.chain) };
            }
        }
        return null;
    }

    function countByBase(comp, base) {
        var n = 0;
        for (var i = 1; i <= comp.numLayers; i++) {
            var nm = comp.layer(i).name;
            if (nm === base || nm.indexOf(base + " ") === 0) n++;
        }
        return n;
    }

    // 滑桿「角色」與兩個專案的命名對照(樂樂式英文 / 妖果式中文)
    // 合成裡已有 control 時自動沿用它現有的滑桿名,新合成才用第一個預設名
    var SLIDER_ROLES = {
        "eye":   ["eye", "眼"],
        "mouth": ["mouth", "嘴"],
        "眉":    ["眉"],
        "emo":   ["emo"]
    };

    function sliderNameFor(comp, role) {
        var names = SLIDER_ROLES[role] || [role];
        var ctrl = findLayer(comp, "control");
        if (ctrl) {
            try {
                var fx = ctrl.property("ADBE Effect Parade");
                for (var i = 0; i < names.length; i++) {
                    if (fx.property(names[i])) return names[i];
                }
            } catch (e) {}
        }
        return names[0];
    }

    function ensureControl(comp) {
        var ctrl = findLayer(comp, "control");
        if (!ctrl) {
            ctrl = comp.layers.addNull(comp.duration);
            ctrl.name = "control";
            ctrl.moveToBeginning();
        }
        var fx = ctrl.property("ADBE Effect Parade");
        // 每種角色:任一命名已存在就不補(妖果的「眼」在,就不會多生一個「eye」)
        for (var role in SLIDER_ROLES) {
            if (!SLIDER_ROLES.hasOwnProperty(role)) continue;
            var names = SLIDER_ROLES[role], found = false;
            for (var i = 0; i < names.length; i++) {
                if (fx.property(names[i])) { found = true; break; }
            }
            if (!found) {
                var s = fx.addProperty("ADBE Slider Control");
                s.name = names[0];
                // 滑桿預設值:eye=0 睜眼、mouth=0 第一張嘴、眉=0 第一個眉毛、
                // emo=1 預設特效(0 是無特效);其餘一律 0
                var initVal = (role === "emo") ? 1 : 0;
                try { s.property(1).setValue(initVal); } catch (e0) {}
            }
        }
        if (!fx.property("face position")) {
            var p = fx.addProperty("ADBE Point Control");
            p.name = "face position";
            p.property(1).setValue([comp.width / 2, comp.height / 2]);
        }
        return ctrl;
    }

    function switchExpr(sliderName, val) {        return 'sliderValue = thisComp.layer("control").effect("' + sliderName + '")("Slider")\n\n' +
               '// 設置透明度\nsliderValue == ' + val + '? 100 : 0\n';
    }

    function opacityProp(layer) {
        return layer.property("ADBE Transform Group").property("ADBE Opacity");
    }
    function scaleProp(layer) {
        return layer.property("ADBE Transform Group").property("ADBE Scale");
    }

    // 把 control 上某滑桿切到指定值(讓剛標記、綁在該值的五官立刻看得到,不會因 opacity 0 像消失)。
    function setSliderValue(comp, sliderName, val) {
        try {
            var ctrl = findLayer(comp, "control");
            if (!ctrl) return;
            var s = ctrl.property("ADBE Effect Parade").property(sliderName);
            if (s) s.property(1).setValue(val);
        } catch (e) {}
    }

    // 讀某圖層不透明度表達式裡綁的滑桿值(switchExpr 寫的 == N),讀不到回傳 null
    function layerSliderVal(layer) {
        try {
            var ex = opacityProp(layer).expression;
            var m = ex.match(new RegExp("==\\s*(\\d+)"));
            if (m) return parseInt(m[1], 10);
        } catch (e) {}
        return null;
    }

    // 收集名稱為 base 或「base」「base N」家族的所有圖層
    function collectByBase(comp, base) {
        var out = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            var nm = comp.layer(i).name;
            if (nm === base || nm.indexOf(base + " ") === 0) out.push(comp.layer(i));
        }
        return out;
    }

    // 五官標記圖層名查找:以中文為主鍵,額外接受英文別名(防使用者自行用英文命名五官時也找得到)。
    // 註:命名頁的「轉英文」刻意不轉這些標記層,所以一般情況用到的是中文主名。
    var FEATURE_NAMES = {
        "閉眼":   ["閉眼", "eye_close"],
        "睜眼":   ["睜眼", "eye_open"],
        "眼":     ["眼"],
        "閉嘴":   ["閉嘴",   "mouth_close"],
        "開嘴":   ["開嘴",   "mouth_open"],
        "說話嘴": ["說話嘴", "mouth_talk"],
        "眉":     ["眉",   "brow"],
        "特效":   ["特效", "emo_fx"],
        "眼軸":   ["眼軸", "eye_axis"],
        "嘴軸":   ["嘴軸", "mouth_axis"]
    };
    function featureNames(zhBase) { return FEATURE_NAMES[zhBase] || [zhBase]; }

    // 用「中文主名」找圖層,找不到再用英文別名找(轉英文後仍可用)
    function findFeature(comp, zhBase) {
        var ns = featureNames(zhBase);
        for (var i = 0; i < ns.length; i++) {
            var L = findLayer(comp, ns[i]);
            if (L) return L;
        }
        return null;
    }
    // 同上,收集整個家族(中英都收)
    function collectFeature(comp, zhBase) {
        var ns = featureNames(zhBase), out = [];
        for (var i = 0; i < ns.length; i++) {
            var fam = collectByBase(comp, ns[i]);
            for (var j = 0; j < fam.length; j++) if (out.indexOf(fam[j]) === -1) out.push(fam[j]);
        }
        return out;
    }

    // 說話開合擠壓表達式:掛在共用「嘴軸」Null 的 Scale 上。
    // mouth 滑桿等於「任何一個說話值」時就開合(同時只有一張嘴可見,故可共用一個嘴軸)。
    function squashMouthExpr(mouthName, activeVals) {
        return [
            "// === 說話開合擠壓(共用嘴軸;mouth 滑桿在說話值時開合) ===",
            "var talk = [" + activeVals.join(", ") + "]; // 各說話嘴的值",
            's = thisComp.layer("control").effect("' + mouthName + '")("Slider");',
            "var speed = 9, amp = 45; // 開合速度 / 幅度(%)",
            "var on = false;",
            "for (var i = 0; i < talk.length; i++) { if (s == talk[i]) on = true; }",
            "if (on) {",
            "  var k = 1 - (amp / 100) * Math.abs(Math.sin(time * speed));",
            "  // 相容 2D Null(嘴軸)與 3D 圖層",
            "  value.length > 2 ? [value[0], value[1] * k, value[2]] : [value[0], value[1] * k];",
            "} else { value; }"
        ].join("\n");
    }

    // 把所有「說話嘴」掛到同一個共用「嘴軸」,並重設開合表達式。回傳 [{name,val}...]。
    function applyTalkSquash(comp, mouthName) {
        var talkMouths = collectFeature(comp, "說話嘴");
        if (talkMouths.length === 0) return [];

        // 建/沿用單一共用嘴軸(放在第一張說話嘴的位置)
        var axis = findFeature(comp, "嘴軸");
        if (!axis) axis = makeAxisNull(comp, talkMouths[0], "嘴軸");

        var vals = [], infos = [];
        for (var i = 0; i < talkMouths.length; i++) {
            var m = talkMouths[i];
            if (m === axis) continue;
            var mv = layerSliderVal(m);
            if (mv === null) { mv = nextSliderValue(comp, mouthName); opacityProp(m).expression = switchExpr(mouthName, mv); }
            // 全部掛到共用嘴軸(指定 parent 時 AE 會保持外觀不跳動)
            if (m.parent !== axis) m.parent = axis;
            // 轉軸時美術反向補償,維持原本角度(跟 makeAxisNull 一致)
            try {
                m.property("ADBE Transform Group").property("ADBE Rotate Z").expression =
                    "value - parent.transform.rotation // 軸轉、美術不轉";
            } catch (eR) {}
            vals.push(mv);
            infos.push({ name: m.name, val: mv });
        }
        scaleProp(axis).expression = squashMouthExpr(mouthName, vals);
        return infos;
    }

    function blinkWindowLines(seed, minGap, maxGap, frames) {
        return [
            "var minGap = " + minGap + ", maxGap = " + maxGap + ";",
            "var blinkDur = " + frames + " * thisComp.frameDuration;",
            "seedRandom(" + seed + ", true);",
            "var t = 0, blink = 0;",
            "while (t < time) {",
            "  t += random(minGap, maxGap);",
            "  if (time >= t && time < t + blinkDur) { blink = 1; break; }",
            "  t += blinkDur;",
            "}"
        ];
    }

    function uniqueSeed() { return Math.floor(Math.random() * 900000) + 1000; }

    // mouth 滑桿的「說話值」:取第一張說話嘴實際綁的值,沒有就回 1
    function talkValue(comp) {
        var t = findFeature(comp, "說話嘴");
        if (t) { var v = layerSliderVal(t); if (v !== null) return v; }
        return 1;
    }

    // 列出某角色 control 的「指定滑桿」每個值對應哪些圖層(表情/狀態/嘴型),給最外層下拉用。
    // role: "eye"/"mouth"/"眉"/"emo"。回傳 [{ val, label, talk }],依值排序。
    function listSliderShapes(comp, role) {
        var sliderName = sliderNameFor(comp, role);
        var byVal = {};
        // mouth 額外標出哪些值是「說話嘴」家族(會開合)
        var talkSet = {};
        if (role === "mouth") {
            var talkFam = collectFeature(comp, "說話嘴");
            for (var a = 0; a < talkFam.length; a++) { var tv = layerSliderVal(talkFam[a]); if (tv !== null) talkSet[tv] = true; }
        }
        for (var i = 1; i <= comp.numLayers; i++) {
            try {
                var op = opacityProp(comp.layer(i));
                if (!op.expressionEnabled) continue;
                var ex = op.expression;
                if (ex.indexOf('effect("' + sliderName + '")') === -1) continue;
                var m = ex.match(new RegExp("==\\s*(\\d+)"));
                if (!m) continue;
                var val = parseInt(m[1], 10);
                if (!byVal[val]) byVal[val] = [];
                byVal[val].push(comp.layer(i).name);
            } catch (e) {}
        }
        var vals = [];
        for (var k in byVal) if (byVal.hasOwnProperty(k)) vals.push(parseInt(k, 10));
        vals.sort(function (x, y) { return x - y; });
        var out = [];
        for (var j = 0; j < vals.length; j++) {
            var v = vals[j];
            out.push({
                val: v,
                talk: !!talkSet[v],
                label: v + ": " + byVal[v].join("/") + (talkSet[v] ? " (說話)" : "")
            });
        }
        return out;
    }

    // 在圖層錨點位置建一個「軸」Null,把圖層 parent 上去。
    // 擠壓表達式掛在軸的 Scale 上 → 把軸的 Rotation 轉到跟美術同角度,
    // 擠壓就沿著那個方向,斜的嘴/眼不會歪掉(skew)。
    // 美術圖層會自動反向補償旋轉,所以轉軸時畫面上的圖不會跟著轉。
    function makeAxisNull(comp, lay, axisName) {
        if (lay.parent && lay.parent.name === axisName) return lay.parent; // 已建過
        var axis = comp.layers.addNull(comp.duration);
        axis.name = axisName;
        axis.moveBefore(lay);
        if (lay.parent) axis.parent = lay.parent;
        axis.property("ADBE Transform Group").property("ADBE Position")
            .setValue(lay.property("ADBE Transform Group").property("ADBE Position").value);
        lay.parent = axis; // 指定 parent 時 AE 會保持外觀不跳動
        // 轉軸時美術反向補償,維持原本角度
        lay.property("ADBE Transform Group").property("ADBE Rotate Z").expression =
            "value - parent.transform.rotation // 軸轉、美術不轉";
        return axis;
    }

    // 佔位線段共用色:#6E5047(可自行再改)
    var PLACEHOLDER_RGB = [0.43137, 0.31373, 0.27843, 1];

    // 讓新生成的圖層跟參考圖層「同一個軸心」:複製參考層的錨點與位置(再把內容畫在錨點上),
    // 這樣旋轉/擠壓的中心點完全一致。沒有參考層時(refLay 為 null)就放在畫面中心。回傳錨點。
    function matchPivot(shape, refLay, comp) {
        var ax, ay;
        var stg = shape.property("ADBE Transform Group");
        if (refLay) {
            var rtg = refLay.property("ADBE Transform Group");
            var a = rtg.property("ADBE Anchor Point").value;
            var p = rtg.property("ADBE Position").value;
            ax = a[0]; ay = a[1];
            try { stg.property("ADBE Anchor Point").setValue([a[0], a[1]]); } catch (e1) {}
            try { stg.property("ADBE Position").setValue([p[0], p[1]]); } catch (e2) {}
        } else {
            ax = comp.width / 2; ay = comp.height / 2;
            try { stg.property("ADBE Anchor Point").setValue([ax, ay]); } catch (e3) {}
            try { stg.property("ADBE Position").setValue([ax, ay]); } catch (e4) {}
        }
        return [ax, ay];
    }

    // 新生成圖層的擺位:有參考層就跟它同父層、疊在它前面;沒有就掛 face null(若有)、放最上面。
    function placeGenShape(comp, shape, refLay) {
        if (refLay) {
            if (refLay.parent) { try { shape.parent = refLay.parent; } catch (e) {} }
            try { shape.moveBefore(refLay); } catch (e2) {}
        } else {
            var fc = findLayer(comp, "face");
            if (fc) { try { shape.parent = fc; } catch (e3) {} }
        }
    }

    // 取生成時的參考層:優先用目前選取的圖層,其次找現有的同類五官,都沒有就回 null(放畫面中心)。
    function genRefLayer(comp, featureNames) {
        if (comp.selectedLayers.length) return comp.selectedLayers[0];
        for (var i = 0; i < featureNames.length; i++) {
            var f = findFeature(comp, featureNames[i]);
            if (f) return f;
        }
        return null;
    }

    // 生成後只選取這一張新圖層,方便你接著直接按標記按鈕。
    function selectOnly(comp, layer) {
        for (var i = 1; i <= comp.numLayers; i++) { try { comp.layer(i).selected = false; } catch (e) {} }
        try { layer.selected = true; } catch (e2) {}
    }

    // 一段 stroke 線(#6E5047,6px,兩端圓角)。逐項各自 try,避免某項丟錯害後面沒設到。
    function addStrokedPath(pathGrp, verts) {
        var pathProp = pathGrp.addProperty("ADBE Vector Shape - Group");
        var myShape = new Shape();
        myShape.vertices    = verts;
        myShape.inTangents  = [[0, 0], [0, 0]];
        myShape.outTangents = [[0, 0], [0, 0]];
        myShape.closed = false;
        pathProp.property("ADBE Vector Shape").setValue(myShape);
        var stroke = pathGrp.addProperty("ADBE Vector Graphic - Stroke");
        try { stroke.property("ADBE Vector Stroke Width").setValue(6); } catch (eW) {}
        try { stroke.property("ADBE Vector Stroke Color").setValue(PLACEHOLDER_RGB); } catch (eC) {}
        try { stroke.property("ADBE Vector Stroke Line Cap").setValue(2); } catch (eP) {}  // Round Cap
        try { stroke.property("ADBE Vector Stroke Line Join").setValue(2); } catch (eJ) {} // Round Join
    }

    // 只生成一張「張嘴」深色橢圓 Shape(不綁滑桿,等你畫好/調好再手動點標記)。
    function createOpenMouth(comp, refLay) {
        var w = 60, h = 40;
        try { w = Math.max(refLay.width * 0.8, 30); h = Math.max(refLay.width * 0.55, 20); } catch (e) {}
        var shape = comp.layers.addShape();
        shape.name = "開嘴(未綁)";
        placeGenShape(comp, shape, refLay);
        var a = matchPivot(shape, refLay, comp);
        var grp = shape.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        grp.name = "mouth";
        var ell = grp.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Ellipse");
        ell.property("ADBE Vector Ellipse Size").setValue([w, h]);
        try { ell.property("ADBE Vector Ellipse Position").setValue([a[0], a[1]]); } catch (eEP) {}
        var fill = grp.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill");
        fill.property("ADBE Vector Fill Color").setValue([0.9569, 0.4824, 0.4549, 1]); // #F47B74
        return shape;
    }

    // 在 refLay 位置生一條圓角端點短線段(#6E5047,6px),不綁滑桿。給「閉嘴」等場合用。
    function createPlaceholderLine(comp, refLay, shapeName, groupName, widthRatio) {
        var lineW = 60;
        try { lineW = Math.max(refLay.width * widthRatio, 30); } catch (e) {}
        var half = lineW / 2;

        var shape = comp.layers.addShape();
        shape.name = shapeName;
        placeGenShape(comp, shape, refLay);
        var a = matchPivot(shape, refLay, comp);

        var grp = shape.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        grp.name = groupName;
        addStrokedPath(grp.property("ADBE Vectors Group"),
            [[a[0] - half, a[1]], [a[0] + half, a[1]]]);
        return shape;
    }

    // 成對線段(左右各一條):眉毛、閉眼共用。一個 Shape Layer 內含兩段線段,不綁滑桿。
    function createPairLine(comp, refLay, shapeName, leftName, rightName, widthRatio, gapRatio) {
        var lineW = 36, gap = 40;
        try {
            lineW = Math.max(refLay.width * widthRatio, 24);
            gap   = Math.max(refLay.width * gapRatio, lineW * 1.6);
        } catch (e) {}
        var half = lineW / 2, off = gap / 2;

        var shape = comp.layers.addShape();
        shape.name = shapeName;
        placeGenShape(comp, shape, refLay);
        var a = matchPivot(shape, refLay, comp);
        var vectors = shape.property("ADBE Root Vectors Group");

        var segs = [{ nm: leftName, cx: -off }, { nm: rightName, cx: off }];
        for (var s = 0; s < segs.length; s++) {
            var grp = vectors.addProperty("ADBE Vector Group");
            grp.name = segs[s].nm;
            addStrokedPath(grp.property("ADBE Vectors Group"),
                [[a[0] + segs[s].cx - half, a[1]], [a[0] + segs[s].cx + half, a[1]]]);
        }
        return shape;
    }

    // 補睜眼:一個 Shape Layer,左右各一隻眼 =「同色直立圓角形狀(實心)+ 上方白色高光點」,不綁滑桿。
    function createEyesPair(comp, refLay) {
        var ew = 34, eh = 44, gap = 80;
        try {
            ew = Math.max(refLay.width * 0.4, 26);
            eh = ew * 1.3;            // 直立、偏高
            gap = Math.max(refLay.width * 1.0, ew * 2.2);
        } catch (e) {}
        var off = gap / 2, dot = Math.max(ew * 0.32, 5), dotY = -eh * 0.25; // 高光放上方

        var shape = comp.layers.addShape();
        shape.name = "眼(未綁)";
        placeGenShape(comp, shape, refLay);
        var a = matchPivot(shape, refLay, comp);
        var vectors = shape.property("ADBE Root Vectors Group");

        // 先加兩個白點群組(疊在最上面),再加兩個眼底群組(在下),確保白點在眼底之上
        var eyes = [{ cx: -off, side: "左" }, { cx: off, side: "右" }];
        for (var d = 0; d < eyes.length; d++) {
            var gd = vectors.addProperty("ADBE Vector Group"); gd.name = "眼點_" + eyes[d].side;
            var gdc = gd.property("ADBE Vectors Group");
            var dotE = gdc.addProperty("ADBE Vector Shape - Ellipse");
            dotE.property("ADBE Vector Ellipse Size").setValue([dot, dot]);
            try { dotE.property("ADBE Vector Ellipse Position").setValue([a[0] + eyes[d].cx, a[1] + dotY]); } catch (eP) {}
            var dotF = gdc.addProperty("ADBE Vector Graphic - Fill");
            dotF.property("ADBE Vector Fill Color").setValue([1, 1, 1, 1]);
        }
        for (var b = 0; b < eyes.length; b++) {
            var gb = vectors.addProperty("ADBE Vector Group"); gb.name = "眼底_" + eyes[b].side;
            var gbc = gb.property("ADBE Vectors Group");
            var rect = gbc.addProperty("ADBE Vector Shape - Rect");
            rect.property("ADBE Vector Rect Size").setValue([ew, eh]);
            try { rect.property("ADBE Vector Rect Position").setValue([a[0] + eyes[b].cx, a[1]]); } catch (eRP) {}
            try { rect.property("ADBE Vector Rect Roundness").setValue(Math.min(ew, eh) * 0.5); } catch (eRR) {}
            var rf = gbc.addProperty("ADBE Vector Graphic - Fill");
            rf.property("ADBE Vector Fill Color").setValue(PLACEHOLDER_RGB);
        }
        return shape;
    }

    // 只有張嘴/說話嘴圖的角色:生一條閉嘴線(不綁滑桿)。
    function createClosedMouth(comp, refLay) {
        return createPlaceholderLine(comp, refLay, "閉嘴(未綁)", "closed_mouth", 0.75);
    }

    // ================= 1. 標記 =================

    // 每個標記:基準名 / 滑桿 / 慣例起始值(base)。
    // 同一個滑桿的值是一條連號序列:base 還沒被占用就用 base,已占用就接在目前最大值 +1。
    //   嘴:每按一次「嘴」就新增一張嘴型,值連號 0、1、2、3…(0 可以是張嘴也可以是閉嘴,看你先標哪張)
    //   說話嘴:選一張既有嘴型按下去 → 原嘴型編號不變,另複製一張「壓縮開合動態」嘴接在最大值後面
    //   眼:0=睜眼、1=閉眼,之後累加(眼睛同理)
    //   眉/特效:從 base 開始一路累加
    var TAGS = {
        "閉眼":   { slider: "eye",   base: 1 },
        "睜眼":   { slider: "eye",   base: 0 },
        "閉嘴":   { slider: "mouth", base: 0 },          // 靜態閉嘴,綁值 0(停止說話=切回 0)
        "開嘴":   { slider: "mouth", base: 1 },          // 靜態張嘴(啊/驚訝/長音,不開合),值連號
        "說話嘴": { slider: "mouth", talkBind: true },   // 直接把選取圖層綁成說話嘴(會開合,不複製)
        "眉":     { slider: "眉",    base: 0 },
        "特效":   { slider: "emo",   base: 1 }, // 廣義表情特效:汗滴、怒氣、驚訝符號、愛心…都可掛在 emo 滑桿上
        "耳":     { slider: null },
        "鼻":     { slider: null }
    };

    // 掃 comp,回傳某滑桿目前被哪些值占用(用於連號分配)。
    function usedSliderValues(comp, sliderName) {
        var used = {};
        for (var i = 1; i <= comp.numLayers; i++) {
            try {
                var op = opacityProp(comp.layer(i));
                if (!op.expressionEnabled) continue;
                var ex = op.expression;
                if (ex.indexOf('effect("' + sliderName + '")') === -1) continue;
                var m = ex.match(new RegExp("==\\s*(\\d+)"));
                if (m) used[parseInt(m[1], 10)] = true;
            } catch (e) {}
        }
        return used;
    }

    // 給某滑桿分配下一個值:base 沒被占用就用 base,否則接在目前最大值 +1。
    function allocSliderValue(comp, sliderName, base) {
        var used = usedSliderValues(comp, sliderName);
        if (!used[base]) return base;
        var mx = -1;
        for (var k in used) {
            if (!used.hasOwnProperty(k)) continue;
            var n = parseInt(k, 10);
            if (n > mx) mx = n;
        }
        return mx + 1;
    }

    function ensureRigNulls(comp) {
        function ensureNull(name) {
            var L = findLayer(comp, name);
            if (!L) { L = comp.layers.addNull(comp.duration); L.name = name; }
            return L;
        }
        var faceN = ensureNull("face"), eyeN = ensureNull("eye"),
            mouthN = ensureNull("mouth"), earN = ensureNull("ear");
        faceN.property("ADBE Transform Group").property("ADBE Position").expression =
            'thisComp.layer("control").effect("face position")("Point")';
        if (!eyeN.parent) eyeN.parent = faceN;
        if (!mouthN.parent) mouthN.parent = faceN;
        return { face: faceN, eye: eyeN, mouth: mouthN, ear: earN };
    }

    // 從圖層名判斷它目前是哪個標記的基準名(例如「開嘴 2」→「開嘴」),不是任何標記名就回 null。
    function tagBaseOfName(name) {
        for (var b in TAGS) {
            if (!TAGS.hasOwnProperty(b)) continue;
            if (name === b || name.indexOf(b + " ") === 0) return b;
        }
        return null;
    }

    // 如果這張圖層已經被標記過「別的」標記(例如先標了「開嘴」,現在要改標「說話嘴」),
    // 直接改名會把舊標記覆蓋掉、原本的狀態就消失了。
    // 改成:偵測到衝突就自動複製一張出來標新的,原圖維持舊標記不動,兩種狀態都保留。
    function duplicateIfConflictingTag(lay, newBase) {
        var oldBase = tagBaseOfName(lay.name);
        if (oldBase === null || oldBase === newBase) return lay;
        var dup = lay.duplicate();
        showStatus("「" + lay.name + "」已經標記過「" + oldBase + "」,自動複製一張來改標「" + newBase + "」,原圖的「" + oldBase + "」保留不變。");
        return dup;
    }

    function doTag(base, fullRig) {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先在時間軸選取要標記的圖層,再按「" + base + "」。"); return; }

        var tag = TAGS[base];

        app.beginUndoGroup("標記 " + base);
        try {
            ensureControl(comp);

            // 「說話嘴」:把選取圖層「本身」綁成會開合的說話嘴(不複製),預設值從 1 起(把 0 留給閉嘴)
            if (tag.talkBind) {
                var mName = sliderNameFor(comp, "mouth");
                var bv = null;
                for (var tb = 0; tb < sel.length; tb++) {
                    var L = duplicateIfConflictingTag(sel[tb], "說話嘴");
                    var bIdx = countByBase(comp, "說話嘴");
                    L.name = (bIdx === 0) ? "說話嘴" : "說話嘴 " + (bIdx + 1);
                    bv = allocSliderValue(comp, mName, 1); // 第一張說話嘴=1,之後連號
                    opacityProp(L).expression = switchExpr(mName, bv);
                }
                var info2 = applyTalkSquash(comp, mName); // 套共用嘴軸開合(嘴軸放在這張嘴的位置)
                if (bv !== null) setSliderValue(comp, mName, bv);
                var ln2 = [];
                for (var q = 0; q < info2.length; q++) ln2.push("「" + info2[q].name + "」= " + info2[q].val);
                showStatus("已把選取圖層直接綁成「說話嘴」(沒有複製,原圖就在 slider 選項裡):" + ln2.join("、") +
                      "。記得另外用「補閉嘴」生成一張閉嘴並標記「閉嘴」(會綁值 0),停止說話才有閉嘴可顯示。");
                return;
            }

            var nulls = fullRig ? ensureRigNulls(comp) : null;
            var lastSlider = null, lastVal = null;

            for (var i = 0; i < sel.length; i++) {
                var lay = duplicateIfConflictingTag(sel[i], base);
                var idx = countByBase(comp, base); // 已有幾個同名 → 決定編號
                lay.name = (idx === 0) ? base : base + " " + (idx + 1);

                if (tag.slider) {
                    // 同一滑桿值連號分配:base 沒被占用就用 base,否則接著最大值 +1,不會共用同值打架
                    var sliderName = sliderNameFor(comp, tag.slider);
                    var v = allocSliderValue(comp, sliderName, tag.base);
                    opacityProp(lay).expression = switchExpr(sliderName, v);
                    lastSlider = sliderName; lastVal = v;
                }
                if (nulls && !lay.parent) {
                    if (base === "耳") lay.parent = nulls.ear;
                    else if (base === "鼻") lay.parent = nulls.face;
                    else if (tag.slider === "eye" || tag.slider === "眉") lay.parent = nulls.eye;
                    else if (tag.slider === "mouth") lay.parent = nulls.mouth;
                }
            }
            // 標記後把滑桿切到剛綁的值,讓這張立刻看得到(不會因 opacity 0 像沒生成)
            if (lastSlider !== null) setSliderValue(comp, lastSlider, lastVal);
        } finally { app.endUndoGroup(); }
    }

    // ================= 生成五官(獨立按鈕,不再綁在「標記」的副作用) =================

    // 生成五官:只「畫出形狀佔位」,不綁滑桿、不切滑桿。畫好/調好後由你自己選取它、再點對應標記按鈕綁定。
    // 位置參考:目前選取的圖層 > 現有同類五官 > 都沒有就放畫面中心。生成後自動只選取這張,方便接著標記。

    // 補開嘴:橢圓張嘴
    function doGenOpenMouth() {
        var comp = activeComp(); if (!comp) return;
        app.beginUndoGroup("生成開嘴佔位");
        try {
            var refLay = genRefLayer(comp, ["閉嘴", "開嘴", "說話嘴"]);
            var lay = createOpenMouth(comp, refLay);
            selectOnly(comp, lay);
            showStatus("已生成「開嘴」佔位(未綁定)。調好大小/顏色後,選取它再點「說話嘴」(會開合)或「開嘴」(靜態)標記按鈕綁滑桿。");
        } finally { app.endUndoGroup(); }
    }

    // 補閉嘴:一條閉嘴線
    function doGenClosedMouth() {
        var comp = activeComp(); if (!comp) return;
        app.beginUndoGroup("生成閉嘴佔位");
        try {
            var refLay = genRefLayer(comp, ["閉嘴", "開嘴", "說話嘴"]);
            var lay = createClosedMouth(comp, refLay);
            selectOnly(comp, lay);
            showStatus("已生成「閉嘴」線段佔位(未綁定)。拉好 Bezier 弧度後,選取它再點「閉嘴」標記按鈕綁滑桿。");
        } finally { app.endUndoGroup(); }
    }

    // 補睜眼:同色方橢圓 + 白點 ×2
    function doGenEyesOpen() {
        var comp = activeComp(); if (!comp) return;
        app.beginUndoGroup("生成睜眼佔位");
        try {
            var refLay = genRefLayer(comp, ["睜眼", "眼", "閉眼"]);
            var lay = createEyesPair(comp, refLay);
            selectOnly(comp, lay);
            showStatus("已生成「睜眼」佔位(左右各一隻:方橢圓+白點,未綁定)。調好後選取它再點「睜眼」標記按鈕綁滑桿。");
        } finally { app.endUndoGroup(); }
    }

    // 補閉眼:左右各一段線(跟眉毛同類),放在眼睛位置
    function doGenClosedEye() {
        var comp = activeComp(); if (!comp) return;
        app.beginUndoGroup("生成閉眼佔位");
        try {
            var refLay = genRefLayer(comp, ["閉眼", "眼", "睜眼"]);
            var lay = createPairLine(comp, refLay, "閉眼(未綁)", "閉眼_左", "閉眼_右", 0.5, 1.1);
            selectOnly(comp, lay);
            showStatus("已生成「閉眼」佔位(左右各一段線,未綁定)。拉好弧度後選取它再點「閉眼」標記按鈕綁滑桿。");
        } finally { app.endUndoGroup(); }
    }

    // 補眉:一個 Shape Layer,左右兩段線段
    function doGenBrows() {
        var comp = activeComp(); if (!comp) return;
        app.beginUndoGroup("生成眉毛佔位");
        try {
            var refLay = genRefLayer(comp, ["眉"]);
            var lay = createPairLine(comp, refLay, "眉(未綁)", "眉_左", "眉_右", 0.5, 0.9);
            selectOnly(comp, lay);
            showStatus("已生成「眉」佔位(左右兩段線,未綁定)。改好形狀後選取它再點「眉」標記按鈕綁滑桿。");
        } finally { app.endUndoGroup(); }
    }

    // 綁五官到 face null:五官沒放進頭部 comp 時,建一個「face」null 並把所有五官 parent 上去,
    // face null 本身不指定 parent,你再自行依情況把它接到頭或身體。
    function doBindFaceNull() {
        var comp = activeComp(); if (!comp) return;
        app.beginUndoGroup("綁五官到 face null");
        try {
            var faceN = findLayer(comp, "face");
            if (!faceN) {
                faceN = comp.layers.addNull(comp.duration);
                faceN.name = "face";
                faceN.moveToBeginning();
            }
            // 五官家族:標記用的中文名(含特殊表情接在後面的圖層也多半是這些族群)
            var bases = ["閉眼", "睜眼", "眼", "閉嘴", "開嘴", "說話嘴", "眉", "特效", "耳", "鼻",
                         "眼軸", "嘴軸"];
            var linked = 0, skipped = 0;
            for (var b = 0; b < bases.length; b++) {
                var fam = collectFeature(comp, bases[b]); // 中英都收(轉英文後也找得到)
                for (var i = 0; i < fam.length; i++) {
                    if (fam[i] === faceN) continue;
                    if (fam[i].parent === faceN) continue;
                    // 已 parent 到別的東西(例如眼/嘴掛在軸上)就不搶,只接「軸」與沒 parent 的五官
                    if (fam[i].parent && bases[b] !== "眼軸" && bases[b] !== "嘴軸") { skipped++; continue; }
                    fam[i].parent = faceN;
                    linked++;
                }
            }
            showStatus("已建/沿用「face」null,把 " + linked + " 個五官圖層掛上去" +
                  (skipped ? "(" + skipped + " 個已掛在軸或其他父層,保留不動)" : "") +
                  "。「face」目前沒有父層 —— 請自行把它的 parent 設成頭(head)或身體(body)。");
        } finally { app.endUndoGroup(); }
    }

    // ---- 特殊表情(暈眼、X眼、哭嚎嘴…):掛到滑桿的下一個空值 ----

    function nextSliderValue(comp, sliderName) {
        // 特殊表情接在該滑桿目前最大值之後(純粹看實際用掉的值,連號往上)
        var used = usedSliderValues(comp, sliderName);
        var maxV = -1;
        for (var k in used) {
            if (!used.hasOwnProperty(k)) continue;
            var n = parseInt(k, 10);
            if (n > maxV) maxV = n;
        }
        return maxV + 1;
    }

    function doSpecialTag() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取特殊表情的圖層(暈眼、X眼、哭嚎嘴…)再按。"); return; }
        var roleIn = prompt("掛在哪個滑桿?(eye/眼、mouth/嘴、眉、emo)", "eye");
        if (roleIn === null) return;
        var ALIAS = { "eye": "eye", "眼": "eye", "mouth": "mouth", "嘴": "mouth", "眉": "眉", "emo": "emo" };
        var role = ALIAS[roleIn];
        if (!role) { alert("滑桿要是 eye/眼、mouth/嘴、眉、emo 其中之一。"); return; }
        app.beginUndoGroup("特殊狀態標記");
        try {
            ensureControl(comp);
            var sliderName = sliderNameFor(comp, role); // 自動沿用該合成的命名(眼 or eye)
            var v = nextSliderValue(comp, sliderName);
            var vIn = prompt("用哪個滑桿值?(這個滑桿下一個空值是 " + v + ")", String(v));
            if (vIn === null) return;
            v = parseInt(vIn, 10); if (isNaN(v)) return;
            var base = prompt("圖層命名(方便之後辨認,例:暈眼):", sel[0].name);
            if (base === null) return;
            for (var i = 0; i < sel.length; i++) {
                if (base !== "") sel[i].name = (i === 0) ? base : base + " " + (i + 1);
                opacityProp(sel[i]).expression = switchExpr(sliderName, v);
            }
            showStatus("完成!演出時把 control > " + sliderName + " 滑桿切到 " + v +
                  " 就會顯示「" + base + "」。(滑桿 key 記得用 HOLD)");
        } finally { app.endUndoGroup(); }
    }

    // 編號狀態(妖果式):多選圖層 → 由上到下命名 base1~baseN,滑桿值依序 0~N-1
    function doNumberedTag() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先由上到下選好狀態圖層(例:五個嘴型),再按「編號狀態」。"); return; }
        var roleIn = prompt("掛在哪個滑桿?(eye/眼、mouth/嘴、眉、emo)", "mouth");
        if (roleIn === null) return;
        var ALIAS = { "eye": "eye", "眼": "eye", "mouth": "mouth", "嘴": "mouth", "眉": "眉", "emo": "emo" };
        var role = ALIAS[roleIn];
        if (!role) { alert("滑桿要是 eye/眼、mouth/嘴、眉、emo 其中之一。"); return; }
        var defBase = { eye: "eye", mouth: "mouth", "眉": "eyebrow", emo: "emo" }[role];
        var base = prompt("圖層基準名(會編成 " + defBase + "1、" + defBase + "2…):", defBase);
        if (base === null || base === "") return;

        app.beginUndoGroup("編號狀態 " + base);
        try {
            ensureControl(comp);
            var sliderName = sliderNameFor(comp, role);
            var lines = [];
            for (var i = 0; i < sel.length; i++) {
                sel[i].name = base + (i + 1);
                opacityProp(sel[i]).expression = switchExpr(sliderName, i);
                lines.push(base + (i + 1) + " → " + sliderName + " = " + i);
            }
            showStatus("完成!對應表:" + lines.join("、") + "(依時間軸由上到下的順序編號)");
        } finally { app.endUndoGroup(); }
    }

    // ================= 2. 一鍵動態 =================

    function doBlink() {
        var comp = activeComp(); if (!comp) return;
        app.beginUndoGroup("隨機眨眼");
        try {
            var closed = findFeature(comp, "閉眼");
            if (closed || findLayer(comp, "control")) {
                // 標準方案:眼滑桿掛隨機眨眼 + 「眨眼」Checkbox 雙模式(妖果式)
                //   勾選 = 自動隨機眨(手動 key 仍以最大值疊加)
                //   取消 = 完全手動,只看你打的 key
                var ctrl = ensureControl(comp);
                var fx = ctrl.property("ADBE Effect Parade");
                var cb = fx.property("眨眼");
                if (!cb) {
                    cb = fx.addProperty("ADBE Checkbox Control");
                    cb.name = "眨眼";
                    cb.property(1).setValue(1);
                }
                var eyeName = sliderNameFor(comp, "eye");
                var slider = fx.property(eyeName).property(1);
                var lines = [
                        "// === 隨機眨眼(面板自動加入)===",
                        '// 「眨眼」勾選 = 自動循環;取消 = 手動接管',
                        'var auto = thisComp.layer("control").effect("眨眼")("Checkbox");'
                    ]
                    .concat(blinkWindowLines(uniqueSeed(), 2.5, 6, 7))
                    .concat(["auto == 1 ? Math.max(value, blink) : value"]);
                slider.expression = lines.join("\n");
                showStatus("已在 control > " + eyeName + " 滑桿掛上隨機眨眼。control 上多了「眨眼」勾選框:" +
                      "勾選=自動隨機眨(手動 key 同時有效,取最大值)、取消=純手動。" +
                      "取消勾選時在 eye 滑桿打 HOLD key:1=閉眼、0=睜眼。");
            } else {
                // 備援方案:沒有閉眼圖層 → 對「睜眼/眼」做縮放擠壓眨眼(透過眼軸,斜眼不會歪)
                var eyeLay = findFeature(comp, "睜眼") || findFeature(comp, "眼") ||
                             (comp.selectedLayers.length ? comp.selectedLayers[0] : null);
                if (!eyeLay) { alert("找不到「閉眼」「睜眼」「眼」圖層。\n請先標記,或選取眼睛圖層後再按一次。"); return; }
                var axis = makeAxisNull(comp, eyeLay, "眼軸");
                var lines2 = ["// === 隨機眨眼:縮放擠壓版(此角色沒有閉眼圖) ==="]
                    .concat(blinkWindowLines(uniqueSeed(), 2.5, 6, 7))
                    .concat(["blink ? [value[0], value[1] * 0.08] : value"]);
                scaleProp(axis).expression = lines2.join("\n");
                showStatus("此角色沒有「閉眼」圖 → 已建「眼軸」Null 套擠壓眨眼(作用在「" + eyeLay.name +
                      "」上)。眼睛若是斜的,把「眼軸」Rotation 轉到跟眼睛同角度,擠壓就沿眼睛方向、不會歪。");
            }
        } finally { app.endUndoGroup(); }
    }

    function doTalkSetup() {
        var comp = activeComp(); if (!comp) return;
        app.beginUndoGroup("說話設定");
        try {
            var ctrl = ensureControl(comp);
            var mouthName = sliderNameFor(comp, "mouth"); // 自動沿用 mouth 或 嘴
            // 收集所有「說話嘴」(可多組:開心說話、不開心說話…),各自有自己的滑桿值
            var talkMouths = collectFeature(comp, "說話嘴");
            var closed = findFeature(comp, "閉嘴");
            var genClosed = false;

            // 沒有說話嘴還是得先有(說話嘴是主角,需要你自己標記)
            if (talkMouths.length === 0) {
                alert("找不到「說話嘴」。\n請先用「補開嘴」生成、調好,選取它再點「說話嘴」標記,再做說話設定。");
                return;
            }
            // 沒有閉嘴 → 直接幫你生一條閉嘴線(綁值 0)讓你調整,省得來回切按鈕
            if (!closed) {
                closed = createClosedMouth(comp, talkMouths[0]);
                closed.name = "閉嘴";
                opacityProp(closed).expression = switchExpr(mouthName, 0);
                genClosed = true;
            }

            // 所有說話嘴共用一個「嘴軸」,擠壓表達式對任何說話值都生效
            var infoArr = applyTalkSquash(comp, mouthName);
            var infos = [];
            for (var i = 0; i < infoArr.length; i++) infos.push("「" + infoArr[i].name + "」= " + infoArr[i].val);

            var msg = "說話設定完成,已對 " + infos.length + " 張說話嘴套上開合擠壓(共用同一個「嘴軸」):\n  " +
                      infos.join("\n  ") + "\n" +
                      "用下面的「開始/停止說話」按鈕打 key,或在 control 的 " + mouthName +
                      " 滑桿自己切換要用哪張嘴。\n\n" +
                      "嘴如果是斜的:把「嘴軸」Rotation 轉到跟嘴同角度,\n" +
                      "美術不會跟著轉,開合就會沿嘴的方向、不會歪。\n\n" +
                      "想要嘴張開但不動(如唱歌長音),改用「開嘴」靜態嘴型,把滑桿 key 到它的值即可。";
            if (genClosed) {
                msg += "\n\n此角色原本沒有閉嘴,我已自動生成一條「閉嘴」線段(綁值 0)。\n" +
                       "用鋼筆工具拉 Bezier 弧度、調 Stroke 配合畫風即可。";
            }
            showStatus(msg);
        } finally { app.endUndoGroup(); }
    }

    function doBreath() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取身體圖層再按「呼吸」。"); return; }
        app.beginUndoGroup("呼吸");
        try {
            for (var i = 0; i < sel.length; i++) {
                scaleProp(sel[i]).expression = [
                    "// === 呼吸(面板自動加入) ===",
                    "var amp = 1.5, period = 3; // 幅度(%) / 週期(秒)",
                    "seedRandom(index, true);",
                    "var ph = random(0, period); // 每個圖層相位錯開",
                    "var y = value[1] + amp * Math.sin((time + ph) * 2 * Math.PI / period);",
                    "value.length > 2 ? [value[0], y, value[2]] : [value[0], y] // 相容 2D/3D 圖層"
                ].join("\n");
            }
        } finally { app.endUndoGroup(); }
        showStatus("已套呼吸到 " + sel.length + " 個圖層(Scale 上下 1.5%,錨點在底部效果最好)。");
    }

    function doFloat() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取圖層再按「漂浮」。"); return; }
        app.beginUndoGroup("漂浮");
        try {
            for (var i = 0; i < sel.length; i++) {
                sel[i].property("ADBE Transform Group").property("ADBE Position").expression = [
                    "// === 上下漂浮(面板自動加入) ===",
                    "var amp = 10, period = 2.5; // 幅度(px) / 週期(秒)",
                    "seedRandom(index, true);",
                    "var ph = random(0, period);",
                    "value + [0, amp * Math.sin((time + ph) * 2 * Math.PI / period)]"
                ].join("\n");
            }
        } finally { app.endUndoGroup(); }
        showStatus("已套漂浮到 " + sel.length + " 個圖層。");
    }

    // dir=+1 正向、-1 反向(相位相反,跟正向的圖層一起擺時會左右交錯)
    function doSway(dir) {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取圖層再按「擺動」。"); return; }
        var sign = (dir < 0) ? -1 : 1;
        app.beginUndoGroup(sign < 0 ? "擺動(反向)" : "擺動");
        try {
            for (var i = 0; i < sel.length; i++) {
                sel[i].property("ADBE Transform Group").property("ADBE Rotate Z").expression = [
                    "// === 微微擺動(面板自動加入) ===",
                    "var amp = 3, period = 2.8; // 幅度(度) / 週期(秒)",
                    "var dir = " + sign + ";          // 方向:1 正向、-1 反向",
                    "seedRandom(index, true);",
                    "var ph = random(0, period); // 每個圖層相位錯開",
                    "value + dir * amp * Math.sin((time + ph) * 2 * Math.PI / period)"
                ].join("\n");
            }
        } finally { app.endUndoGroup(); }
        showStatus("已套" + (sign < 0 ? "反向" : "") + "擺動到 " + sel.length +
            " 個圖層(Rotation ±3°)。建議先建控制NULL再套,避免跟其他旋轉表達式衝突。");
    }

    // 走路 / 跑步「上下浮動」:不套骨架,只在選取圖層的 Position(垂直彈跳)
    // 加上 Rotation(左右微傾)打出「一個完整步態循環」的關鍵幀,讓你自己複製貼上接成整段,
    // 平移由你自己拉。一個循環 = 兩步(身體上下彈兩次)。
    //   走路:循環 0.7s、彈跳 8px、左右傾 1.5°
    //   跑步:循環 0.45s、彈跳 18px、左右傾 3°
    function doWalkCycle(kind) {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取角色(身體或整體 Null)再按「" + kind + "」。"); return; }
        var run = (kind === "跑步");
        var cycleDur = run ? 0.45 : 0.7;   // 一個步態循環長度(秒)
        var bobAmp   = run ? 18 : 8;        // 垂直彈跳幅度(px,往上)
        var tilt     = run ? 3 : 1.5;       // 左右微傾幅度(度)
        // 一個循環取 5 個取樣點:谷-峰-谷-峰-谷(兩步、兩次彈跳),首尾相同可無縫接續
        var us   = [0,    0.25,  0.5,  0.75, 1];
        var bob  = [0,    1,     0,    1,    0];     // 0=低(著地)、1=高(騰空)
        var lean = [0,    1,     0,   -1,    0];     // 左右交替傾斜
        app.beginUndoGroup(kind + "循環");
        try {
            for (var i = 0; i < sel.length; i++) {
                var t0 = comp.time;
                var pos = sel[i].property("ADBE Transform Group").property("ADBE Position");
                var rot = sel[i].property("ADBE Transform Group").property("ADBE Rotate Z");
                var base = pos.valueAtTime(t0, false);
                var rBase = rot.valueAtTime(t0, false);
                for (var k = 0; k < us.length; k++) {
                    var t = t0 + us[k] * cycleDur;
                    var v = base.slice();
                    v[1] = base[1] - bobAmp * bob[k];   // 往上彈
                    pos.setValueAtTime(t, v);
                    rot.setValueAtTime(t, rBase + tilt * lean[k]);
                }
                easyEaseRange(pos, t0, t0 + cycleDur);
                easyEaseRange(rot, t0, t0 + cycleDur);
            }
        } finally { app.endUndoGroup(); }
        showStatus("已在 " + sel.length + " 個圖層打上一個「" + kind + "」步態循環(" + cycleDur +
            "s,上下 " + bobAmp + "px、左右 ±" + tilt + "°)。在時間軸框選這組 key 複製貼上即可接成整段;" +
            "平移自己拉。要無縫循環可在屬性上加 loopOut() 表達式。");
    }

    // 給某屬性在 [t0, t1] 範圍內的所有 key 套 Easy Ease
    function easyEaseRange(prop, t0, t1) {
        try {
            var dims = 1;
            try { dims = prop.value.length || 1; } catch (eD) { dims = 1; }
            for (var k = 1; k <= prop.numKeys; k++) {
                var kt = prop.keyTime(k);
                if (kt < t0 - 0.0001 || kt > t1 + 0.0001) continue;
                var inE = [], outE = [];
                for (var d = 0; d < dims; d++) {
                    inE.push(new KeyframeEase(0, 33.3333));
                    outE.push(new KeyframeEase(0, 33.3333));
                }
                prop.setInterpolationTypeAtKey(k,
                    KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
                prop.setTemporalEaseAtKey(k, inE, outE);
            }
        } catch (e) {}
    }

    // ================= 4. 表達式工具 =================

    var PROP_CHOICES = [
        { label: "位置",     match: "ADBE Position" },
        { label: "縮放",     match: "ADBE Scale" },
        { label: "旋轉",     match: "ADBE Rotate Z" },
        { label: "不透明度", match: "ADBE Opacity" },
        { label: "錨點",     match: "ADBE Anchor Point" }
    ];

    // 收集要套表達式的屬性:
    //   時間軸有「選取屬性」(反白 Position 之類)→ 套在那些屬性上
    //   只選圖層 → 套在下拉選單指定的變形屬性上
    function getExprTargets(comp, dropdownIndex) {
        var sel = comp.selectedLayers;
        if (sel.length === 0) return null;
        var props = [], i, j;
        for (i = 0; i < sel.length; i++) {
            var sp;
            try { sp = sel[i].selectedProperties; } catch (e) { sp = []; }
            for (j = 0; j < sp.length; j++) {
                if (sp[j].propertyType === PropertyType.PROPERTY && sp[j].canSetExpression) props.push(sp[j]);
            }
        }
        if (props.length > 0) return props;
        var match = PROP_CHOICES[dropdownIndex].match;
        for (i = 0; i < sel.length; i++) {
            try {
                var p = sel[i].property("ADBE Transform Group").property(match);
                if (p && p.canSetExpression) props.push(p);
            } catch (e) {}
        }
        return props;
    }

    function applyExprToSelection(exprText, dropdownIndex, undoName) {
        var comp = activeComp(); if (!comp) return;
        var props = getExprTargets(comp, dropdownIndex);
        if (!props) { alert("先選取圖層(或直接反白要套的屬性)再按按鈕。"); return; }
        if (props.length === 0) { alert("選取的圖層上找不到可套表達式的屬性。"); return; }
        var ok = 0, fail = [];
        app.beginUndoGroup(undoName);
        try {
            for (var i = 0; i < props.length; i++) {
                try { props[i].expression = exprText; ok++; }
                catch (e) { fail.push(props[i].parentProperty ? props[i].name : "?"); }
            }
        } finally { app.endUndoGroup(); }
        var msg = (exprText === "" ? "已清除 " : "已套用到 ") + ok + " 個屬性。";
        if (fail.length) {
            // 有套不上的 → 視為失敗,跳通知
            alert(msg + "\n套不上的:" + fail.join("、") + "(表達式跟屬性維度可能不合)");
        } else {
            showStatus(msg);
        }
    }

    // ================= 5. 快速命名 + 控制 NULL =================
    //
    // 一張中英對照表(NAME_MAP)：雙向轉換、更名按鈕、骨架綁定都共用這張表。
    // 轉換邏輯：掃整個 comp，圖層名若完全符合「中文」→ 換成「英文」（或反向）。
    // 帶數字後綴的也抓得到（頭1 → head1）。
    // 不在表裡的圖層一律不動。

    // ── 中英對照表（含分類，UI 用分類排列）─────────────────
    var NAME_MAP = [
        // category 是 UI 分組用，不影響轉換邏輯
        { zh:"頭",    en:"head",      cat:"臉部" },
        { zh:"臉",    en:"face",      cat:"臉部" },
        { zh:"眼睛",  en:"eye",       cat:"臉部" },
        { zh:"嘴巴",  en:"mouth",     cat:"臉部" },
        { zh:"鼻子",  en:"nose",      cat:"臉部" },
        { zh:"眉毛",  en:"eyebrow",   cat:"臉部" },
        { zh:"耳朵",  en:"ear",       cat:"臉部" },

        { zh:"身體",  en:"body",      cat:"身體" },
        { zh:"衣服",  en:"cloth",     cat:"身體" },
        { zh:"裙子",  en:"skirt",     cat:"身體" },
        { zh:"褲子",  en:"pants",     cat:"身體" },
        { zh:"腰帶",  en:"belt",      cat:"身體" },
        { zh:"屁股",  en:"hip",       cat:"身體" },
        { zh:"手",    en:"hand",      cat:"身體" },
        { zh:"腳",    en:"foot",      cat:"身體" },

        // 手臂只分上下臂(各左右),整隻沒拆的就命名為「上臂」
        { zh:"上臂左", en:"arm_up_L",  cat:"手臂" },
        { zh:"下臂左", en:"arm_low_L", cat:"手臂" },
        { zh:"上臂右", en:"arm_up_R",  cat:"手臂" },
        { zh:"下臂右", en:"arm_low_R", cat:"手臂" },

        // 腿只分大小腿(各左右),整隻沒拆的就命名為「大腿」
        { zh:"大腿左", en:"leg_up_L",  cat:"腿腳" },
        { zh:"小腿左", en:"leg_low_L", cat:"腿腳" },
        { zh:"大腿右", en:"leg_up_R",  cat:"腿腳" },
        { zh:"小腿右", en:"leg_low_R", cat:"腿腳" },

        { zh:"頭髮",  en:"hair",      cat:"配件" },
        { zh:"帽子",  en:"hat",       cat:"配件" },
        { zh:"包包",  en:"bag",       cat:"配件" },
        { zh:"尾巴",  en:"tail",      cat:"配件" },
        { zh:"陰影",  en:"shadow",    cat:"配件" },
        { zh:"光",    en:"light",     cat:"配件" },

        // 較少用的配件,命名頁預設收合在「更多配件」裡
        { zh:"眼鏡",  en:"glasses",   cat:"配件2" },
        { zh:"圍巾",  en:"scarf",     cat:"配件2" },
        { zh:"項鍊",  en:"necklace",  cat:"配件2" },
        { zh:"翅膀",  en:"wing",      cat:"配件2" },
        { zh:"寶石",  en:"gem",       cat:"配件2" },
        { zh:"鈕扣",  en:"button",    cat:"配件2" },
        { zh:"鞋",    en:"shoe",      cat:"配件2" },
        { zh:"線",    en:"line",      cat:"配件2" }
    ];

    // 反向語序別名(左上臂/左大腿…)：只用於中英轉換比對，不出現在命名按鈕上。
    // 整隻沒拆的手臂/腿一律當「上臂 / 大腿」(對應骨架的 arm_up / leg_up)。
    var NAME_ALIASES = [
        { zh:"左手臂", en:"arm_up_L" },  // 整隻手臂 = 上臂
        { zh:"右手臂", en:"arm_up_R" },
        { zh:"手臂左", en:"arm_up_L" },
        { zh:"手臂右", en:"arm_up_R" },
        { zh:"左上臂", en:"arm_up_L" },
        { zh:"右上臂", en:"arm_up_R" },
        { zh:"左下臂", en:"arm_low_L" },
        { zh:"右下臂", en:"arm_low_R" },
        { zh:"左腿",  en:"leg_up_L" },   // 整隻腿 = 大腿
        { zh:"右腿",  en:"leg_up_R" },
        { zh:"腿左",  en:"leg_up_L" },
        { zh:"腿右",  en:"leg_up_R" },
        { zh:"左大腿", en:"leg_up_L" },
        { zh:"右大腿", en:"leg_up_R" },
        { zh:"左小腿", en:"leg_low_L" },
        { zh:"右小腿", en:"leg_low_R" }
    ];

    // 使用者自訂對照（存 AE 偏好設定）
    var NAMEMAP_SEC = "CharacterPanel_NameMap";

    function nameMapSave(items) {
        try {
            app.settings.saveSetting(NAMEMAP_SEC, "count", String(items.length));
            for (var i = 0; i < items.length; i++) {
                app.settings.saveSetting(NAMEMAP_SEC, "zh_" + i, encodeURIComponent(items[i].zh));
                app.settings.saveSetting(NAMEMAP_SEC, "en_" + i, encodeURIComponent(items[i].en));
            }
        } catch (e) {}
    }

    function nameMapLoad() {
        var items = [];
        try {
            if (!app.settings.haveSetting(NAMEMAP_SEC, "count")) return [];
            var n = parseInt(app.settings.getSetting(NAMEMAP_SEC, "count"), 10) || 0;
            for (var i = 0; i < n; i++) {
                items.push({
                    zh: decodeURIComponent(app.settings.getSetting(NAMEMAP_SEC, "zh_" + i)),
                    en: decodeURIComponent(app.settings.getSetting(NAMEMAP_SEC, "en_" + i))
                });
            }
        } catch (e) {}
        return items;
    }

    function fullMap() {
        // 內建 + 使用者自訂合併，自訂優先（放後面，比對時先掃自訂）→ 給命名按鈕用
        return NAME_MAP.concat(nameMapLoad());
    }

    // 給中英轉換用：額外加入反向語序別名(左手/右手…)。
    // 別名放最前面、NAME_MAP 居中、使用者自訂放最後 → 比對時優先順序：自訂 > NAME_MAP > 別名,
    // 同一個 en 對到多個 zh 時，轉中文會優先採用 NAME_MAP/自訂裡的寫法。
    function convMap() {
        // 五官標記層(閉眼/嘴/說話嘴/眉…)刻意不納入轉換:它們是動態按鈕讀取的依據,
        // 保持中文不轉,避免轉英文後要全鏈雙語對應。需要英文結構的只有骨架/身體部位。
        return NAME_ALIASES.concat(NAME_MAP).concat(nameMapLoad());
    }

    // ── 命名輔助：數同名家族、判斷純數字 ─────────────────────
    function isAllDigits(s) {
        if (s.length === 0) return false;
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i);
            if (c < 48 || c > 57) return false;
        }
        return true;
    }

    // 數「head」「head1」「head 2」這類都算同一家族
    function nameCount(comp, base) {
        var n = 0;
        for (var i = 1; i <= comp.numLayers; i++) {
            var nm = comp.layer(i).name;
            if (nm === base) { n++; continue; }
            if (nm.indexOf(base) === 0) {
                var rest = nm.substring(base.length);
                if (rest.charAt(0) === " ") rest = rest.substring(1);
                if (isAllDigits(rest)) n++;
            }
        }
        return n;
    }

    // ── 更名按鈕（選取圖層 → 按按鈕 → 改名）─────────────────
    // toEn=true 寫英文，toEn=false 寫中文
    function doRenameItem(entry, toEn) {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取圖層,再點名稱按鈕。"); return; }
        var base = toEn ? entry.en : entry.zh;
        app.beginUndoGroup("更名 " + base);
        try {
            var existing = nameCount(comp, base);
            if (sel.length === 1 && existing === 0) {
                sel[0].name = base;
            } else {
                for (var i = 0; i < sel.length; i++)
                    sel[i].name = base + (existing + i + 1);
            }
        } finally { app.endUndoGroup(); }
    }

    // ── 批次轉換：掃整個 comp，按對照表改名 ─────────────────
    // direction: "toEn" or "toZh"
    function doConvertAll(direction) {
        var comp = activeComp(); if (!comp) return;
        var map = convMap();
        var count = 0;
        app.beginUndoGroup("命名轉換 " + (direction === "toEn" ? "→英文" : "→中文"));
        try {
            for (var i = 1; i <= comp.numLayers; i++) {
                var lay = comp.layer(i);
                var nm  = lay.name;
                for (var m = map.length - 1; m >= 0; m--) { // 從後往前（自訂優先）
                    var src = direction === "toEn" ? map[m].zh : map[m].en;
                    var dst = direction === "toEn" ? map[m].en : map[m].zh;
                    if (nm === src) {
                        lay.name = dst; count++; break;
                    }
                    // 帶數字後綴：「頭1」→「head1」、「眉 2」→「brow 2」(保留空格)
                    if (nm.indexOf(src) === 0) {
                        var tail = nm.substring(src.length);
                        if (/^\d+$/.test(tail) || /^ \d+$/.test(tail)) {
                            lay.name = dst + tail; count++; break;
                        }
                    }
                }
            }
        } finally { app.endUndoGroup(); }
        showStatus("轉換完成，更名了 " + count + " 個圖層。對照表以外的圖層不會動。");
    }

    // isAllDigits / nameCount 已在上方定義，這裡沿用

    // ── 選取圖層轉換（只動選取的，不掃全 comp）──────────────
    function doConvertSelected(direction) {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取要轉換的圖層。"); return; }
        var map = convMap();
        var count = 0;
        app.beginUndoGroup("選取圖層命名轉換");
        try {
            for (var s = 0; s < sel.length; s++) {
                var nm = sel[s].name;
                for (var m = map.length - 1; m >= 0; m--) {
                    var src = direction === "toEn" ? map[m].zh : map[m].en;
                    var dst = direction === "toEn" ? map[m].en : map[m].zh;
                    if (nm === src) { sel[s].name = dst; count++; break; }
                    if (nm.indexOf(src) === 0) {
                        var tail = nm.substring(src.length);
                        if (/^\d+$/.test(tail) || /^ \d+$/.test(tail)) { sel[s].name = dst + tail; count++; break; }
                    }
                }
            }
        } finally { app.endUndoGroup(); }
        if (count === 0) showStatus("選取的圖層名稱都不在對照表裡(沒有更名)。");
        else showStatus("轉換完成，更名了 " + count + " 個圖層。");
    }

    // ── 控制 NULL：建在圖層錨點位置,圖層 parent 上去 ──────────
    // 原圖層留給微動表達式(呼吸/漂浮/wiggle),劇情動作 key 打在 NULL 上,兩邊不打架。
    function makeCtrlNull(comp, lay, nullName) {
        var n = comp.layers.addNull(comp.duration);
        n.name = nullName;
        n.moveBefore(lay);
        if (lay.parent) n.parent = lay.parent;
        n.property("ADBE Transform Group").property("ADBE Position")
            .setValue(lay.property("ADBE Transform Group").property("ADBE Position").value);
        lay.parent = n; // 指定 parent 時 AE 會保持外觀不跳動
        return n;
    }

    function doNullEach() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers.slice(0); // 先複製,建 NULL 過程會動到選取
        if (sel.length === 0) { alert("先選取要加控制 NULL 的圖層。"); return; }
        app.beginUndoGroup("各建控制 NULL");
        try {
            for (var i = 0; i < sel.length; i++) {
                var base = sel[i].name + "_null";
                var idx = countByBase(comp, base);
                makeCtrlNull(comp, sel[i], (idx === 0) ? base : base + " " + (idx + 1));
            }
        } finally { app.endUndoGroup(); }
    }

    function doNullShared() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers.slice(0);
        if (sel.length === 0) { alert("先選取要綁在同一個 NULL 下的圖層。"); return; }
        var nm = prompt("這個控制 NULL 的名字:", "NULL");
        if (!nm) return;
        app.beginUndoGroup("共建控制 NULL");
        try {
            var n = makeCtrlNull(comp, sel[0], nm);
            for (var i = 1; i < sel.length; i++) sel[i].parent = n;
        } finally { app.endUndoGroup(); }
        showStatus(sel.length + " 個圖層已綁到「" + nm + "」之下,劇情動作打在它身上。");
    }

    // 算圖層在 comp 座標下的外框(來源:sourceRectAtTime + toComp)
    function layerBBox(layer, t) {
        try {
            var r = layer.sourceRectAtTime(t, false);
            if (r.width <= 0 || r.height <= 0) return null;
            var corners = [
                [r.left,           r.top],
                [r.left + r.width, r.top],
                [r.left,           r.top + r.height],
                [r.left + r.width, r.top + r.height]
            ];
            var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (var c = 0; c < corners.length; c++) {
                var pt = layer.toComp(corners[c]);
                if (pt[0] < minX) minX = pt[0];
                if (pt[1] < minY) minY = pt[1];
                if (pt[0] > maxX) maxX = pt[0];
                if (pt[1] > maxY) maxY = pt[1];
            }
            return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
        } catch (e) { return null; }
    }

    function bboxOverlapArea(a, b) {
        var w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        var h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
        if (w <= 0 || h <= 0) return 0;
        return w * h;
    }

    function isDescendant(layer, maybeAncestor) {
        var p = layer.parent;
        while (p) { if (p === maybeAncestor) return true; p = p.parent; }
        return false;
    }

    // ── 依重疊自動綁父層:給對照表/骨架規則涵蓋不到的零件用(褲子線、OOline、寶石、包包…)──
    // 對每個選取的圖層,在同 comp 其他圖層裡找畫面重疊比例最高的一個當 parent(不限上下)。
    // 用目前時間那一格的外框比對,門檻 20% 以下不綁(避免亂猜)。
    var OVERLAP_THRESHOLD = 0.2;

    function doAutoParentByOverlap() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取要綁定的零件圖層(可複選),再按此鈕。"); return; }
        var t = comp.time;

        app.beginUndoGroup("依重疊自動綁父層");
        var linked = 0, skipped = [], noMatch = [];
        try {
            for (var s = 0; s < sel.length; s++) {
                var lay = sel[s];
                if (lay.parent) { skipped.push(lay.name); continue; }
                var bbox = layerBBox(lay, t);
                if (!bbox) { noMatch.push(lay.name + "(取不到外框)"); continue; }
                var area = (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY);

                var best = null, bestRatio = 0;
                for (var i = 1; i <= comp.numLayers; i++) {
                    var cand = comp.layer(i);
                    if (cand === lay) continue;
                    if (cand.nullLayer || cand.adjustmentLayer) continue;
                    if (isDescendant(cand, lay)) continue; // 避免把自己的子孫設成父層(循環)
                    var cbbox = layerBBox(cand, t);
                    if (!cbbox) continue;
                    var ratio = bboxOverlapArea(bbox, cbbox) / area;
                    if (ratio > bestRatio) { bestRatio = ratio; best = cand; }
                }

                if (best && bestRatio >= OVERLAP_THRESHOLD) {
                    lay.parent = best;
                    linked++;
                } else {
                    noMatch.push(lay.name + (best
                        ? "(最高重疊 " + Math.round(bestRatio * 100) + "%,低於門檻)"
                        : "(找不到有重疊的圖層)"));
                }
            }
        } finally { app.endUndoGroup(); }

        var msg = "已自動綁定 " + linked + " 個零件。";
        if (skipped.length)  msg += "\n已跳過(原本就有 parent):\n  " + skipped.join("、");
        if (noMatch.length)  msg += "\n沒綁到(請手動設定 parent):\n  " + noMatch.join("、");
        showStatus(msg);
    }

    // ================= 6. 節奏調整 =================

    // 遞迴收集「有 2 個以上 key 且掛著 loopOut」的屬性(含 Puppet pin)
    function scanLoopProps(group, out) {
        for (var i = 1; i <= group.numProperties; i++) {
            var p;
            try { p = group.property(i); } catch (e) { continue; }
            if (!p) continue;
            if (p.propertyType === PropertyType.PROPERTY) {
                try {
                    if (p.numKeys >= 2 && p.expressionEnabled && p.expression.indexOf("loopOut") !== -1) out.push(p);
                } catch (e) {}
            } else {
                try { scanLoopProps(p, out); } catch (e) {}
            }
        }
    }

    // 循環 key 節奏:輸入「一趟幾格」,把選取圖層上所有 loop 的 key 重新等比排時間
    function retimeLoopKeys() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取有循環 key 的圖層(嘴、呼吸、Puppet 都可以)。"); return; }
        var frames = promptSlider("循環 key 節奏", "循環一趟要幾格?(第一個到最後一個 key 的距離)", 7, 1, 60);
        if (frames === null) return;
        if (frames <= 0) { alert("要輸入正數。"); return; }
        var newSpan = frames * comp.frameDuration;

        var count = 0;
        app.beginUndoGroup("循環 key 節奏");
        try {
            for (var s = 0; s < sel.length; s++) {
                var props = [];
                scanLoopProps(sel[s], props);
                for (var p = 0; p < props.length; p++) {
                    var prop = props[p];
                    var n = prop.numKeys;
                    var t1 = prop.keyTime(1);
                    var oldSpan = prop.keyTime(n) - t1;
                    if (oldSpan <= 0) continue;
                    var times = [], vals = [];
                    for (var k = 1; k <= n; k++) {
                        times.push(t1 + (prop.keyTime(k) - t1) * newSpan / oldSpan);
                        vals.push(prop.keyValue(k));
                    }
                    for (var r = n; r >= 1; r--) prop.removeKey(r);
                    for (var a = 0; a < n; a++) prop.setValueAtTime(times[a], vals[a]);
                    count++;
                }
            }
        } finally { app.endUndoGroup(); }
        if (count === 0) alert("選取的圖層上找不到「key + loopOut」的循環屬性。");
        else showStatus("已重排 " + count + " 個循環屬性,一趟 = " + frames + " 格。");
    }

    // 在表達式文字裡找「label + 數字」,把數字乘上倍率
    function scaleNumber(ex, label, factor) {
        var idx = ex.indexOf(label);
        if (idx === -1) return null;
        var start = idx + label.length, end = start;
        while (end < ex.length && "0123456789.".indexOf(ex.charAt(end)) !== -1) end++;
        var num = parseFloat(ex.substring(start, end));
        if (isNaN(num)) return null;
        var v = Math.round(num * factor * 100) / 100;
        return ex.substring(0, idx) + label + v + ex.substring(end);
    }

    // 遞迴收集有表達式的屬性
    function scanExprProps(group, out) {
        for (var i = 1; i <= group.numProperties; i++) {
            var p;
            try { p = group.property(i); } catch (e) { continue; }
            if (!p) continue;
            if (p.propertyType === PropertyType.PROPERTY) {
                try { if (p.expressionEnabled && p.expression !== "") out.push(p); } catch (e) {}
            } else {
                try { scanExprProps(p, out); } catch (e) {}
            }
        }
    }

    // 表達式倍速:speed/wiggle 乘上倍率、period 除以倍率(對面板生的說話/呼吸/漂浮都有效)
    function retimeExprSpeed() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取掛了動態表達式的圖層。"); return; }
        var m = promptStepper("表達式倍速", "倍速?(2 = 快兩倍,0.5 = 慢一半)", 1, 0.1);
        if (m === null) return;
        if (m <= 0) { alert("要輸入正數。"); return; }

        var count = 0;
        app.beginUndoGroup("表達式倍速");
        try {
            for (var s = 0; s < sel.length; s++) {
                var props = [];
                scanExprProps(sel[s], props);
                for (var p = 0; p < props.length; p++) {
                    var ex = props[p].expression, changed = false, r;
                    r = scaleNumber(ex, "var speed = ", m);     if (r !== null) { ex = r; changed = true; }
                    r = scaleNumber(ex, "period = ", 1 / m);    if (r !== null) { ex = r; changed = true; }
                    r = scaleNumber(ex, "wiggle(", m);          if (r !== null) { ex = r; changed = true; }
                    if (changed) { props[p].expression = ex; count++; }
                }
            }
        } finally { app.endUndoGroup(); }
        if (count === 0) alert("選取的圖層上找不到可調速的表達式(speed / period / wiggle)。");
        else showStatus("已調整 " + count + " 個表達式,倍速 ×" + m + "。");
    }

    // 在 wiggle(freq, amp) 裡把第二個參數(幅度)乘上倍率
    function scaleWiggleAmp(ex, factor) {
        var idx = ex.indexOf("wiggle(");
        if (idx === -1) return null;
        var start = idx + "wiggle(".length;
        // 跳過第一個參數(頻率)到逗號
        var comma = ex.indexOf(",", start);
        if (comma === -1) return null;
        var p = comma + 1;
        while (p < ex.length && ex.charAt(p) === " ") p++;
        var end = p;
        while (end < ex.length && "0123456789.".indexOf(ex.charAt(end)) !== -1) end++;
        var num = parseFloat(ex.substring(p, end));
        if (isNaN(num)) return null;
        var v = Math.round(num * factor * 100) / 100;
        return ex.substring(0, p) + v + ex.substring(end);
    }

    // 表達式倍幅:把面板動態的「幅度」放大/縮小(呼吸/漂浮/擺動的 amp、說話開合 amp、wiggle 幅度)。
    // 倍速只改快慢,倍幅才改「動多大」—— 感覺沒差通常是因為幅度太小,用這個放大。
    function retimeExprAmp() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取掛了動態表達式的圖層。"); return; }
        var m = promptStepper("表達式倍幅", "倍幅?(2 = 幅度兩倍,0.5 = 一半)", 1, 0.1);
        if (m === null) return;
        if (m <= 0) { alert("要輸入正數。"); return; }

        var count = 0;
        app.beginUndoGroup("表達式倍幅");
        try {
            for (var s = 0; s < sel.length; s++) {
                var props = [];
                scanExprProps(sel[s], props);
                for (var p = 0; p < props.length; p++) {
                    var ex = props[p].expression, changed = false, r;
                    r = scaleNumber(ex, "amp = ", m);     if (r !== null) { ex = r; changed = true; }
                    r = scaleWiggleAmp(ex, m);            if (r !== null) { ex = r; changed = true; }
                    if (changed) { props[p].expression = ex; count++; }
                }
            }
        } finally { app.endUndoGroup(); }
        if (count === 0) alert("選取的圖層上找不到可調幅度的表達式(amp / wiggle)。");
        else showStatus("已調整 " + count + " 個表達式,幅度 ×" + m + "。");
    }

    // ---- 常用表達式庫(存在 AE 偏好設定,跨專案永久保留) ----

    var LIB_SECTION = "CharacterPanel_ExprLib";

    function libSave(items) {
        try {
            app.settings.saveSetting(LIB_SECTION, "count", String(items.length));
            for (var i = 0; i < items.length; i++) {
                app.settings.saveSetting(LIB_SECTION, "name_" + i, encodeURIComponent(items[i].name));
                app.settings.saveSetting(LIB_SECTION, "expr_" + i, encodeURIComponent(items[i].expr));
            }
        } catch (e) {}
    }

    function libLoad() {
        var items = [];
        try {
            if (!app.settings.haveSetting(LIB_SECTION, "count")) {
                // 第一次使用先放兩個範例
                items = [
                    { name: "持續旋轉(暈眼用)", expr: "value + time * 180" },
                    { name: "驚嚇震動", expr: "wiggle(12, 6)" }
                ];
                libSave(items);
                return items;
            }
            var n = parseInt(app.settings.getSetting(LIB_SECTION, "count"), 10) || 0;
            for (var i = 0; i < n; i++) {
                items.push({
                    name: decodeURIComponent(app.settings.getSetting(LIB_SECTION, "name_" + i)),
                    expr: decodeURIComponent(app.settings.getSetting(LIB_SECTION, "expr_" + i))
                });
            }
        } catch (e) {}
        return items;
    }

    // ================= 骨架快速綁定 =================
    //
    // 腰果式命名規則 (參考腰果後期作品):
    //   上臂: armL1 / armR1   下臂: armL2 / armR2
    //   大腿: legL1 / legR1   小腿: legL2 / legR2
    //   下臂多嘴型切換: armL2-1, armL2-2 … parent 到「LH_下」Null
    //   Body → armL1 → (LH_下 Null) → armL2-x
    //
    // 樂樂式命名規則 (早期):
    //   arm_up_L / arm_low_L / leg_up_L / leg_low_L

    // 骨架預設:定義父子鏈
    // chain: [ {child, parent}, ... ]
    // child/parent 用前綴比對(不分大小寫)
    //
    // 樂樂式結構（含全身NULL總根，位置在腳底）:
    //   全身NULL（腳底）
    //   ├─ 屁股 ─ 身體 ─ arm_up_L/R ─ arm_low_L/R
    //   │              └ head
    //   ├─ leg_up_L ─ leg_low_L
    //   └─ leg_up_R ─ leg_low_R
    //   （大腿直接掛全身NULL，不經過屁股/身體）
    var BODY_NULL_NAME = "全身NULL";

    var SKELETON_PRESETS = {
        "腰果式": {
            desc: "armL1→Body, armL2→armL1, legL1→Body, legL2→legL1 (左右對稱)",
            bodyNull: false,
            chains: [
                { child: "armL1", parent: "Body" },
                { child: "armR1", parent: "Body" },
                { child: "armL2", parent: "armL1" },
                { child: "armR2", parent: "armR1" },
                { child: "legL1", parent: "Body" },
                { child: "legR1", parent: "Body" },
                { child: "legL2", parent: "legL1" },
                { child: "legR2", parent: "legR1" },
                { child: "head",  parent: "Body" }
            ]
        },
        "樂樂式": {
            desc: "全身NULL總根；身體→屁股→NULL；大腿→NULL；小腿→大腿；手臂/頭→身體",
            bodyNull: true, // 需要先建全身NULL(腳底)
            chains: [
                // 軀幹鏈：屁股掛總根、身體掛屁股
                { child: "hip",       parent: BODY_NULL_NAME },
                { child: "body",      parent: "hip" },
                // 手臂：掛身體
                { child: "arm_up_L",  parent: "body" },
                { child: "arm_up_R",  parent: "body" },
                { child: "arm_low_L", parent: "arm_up_L" },
                { child: "arm_low_R", parent: "arm_up_R" },
                // 頭：掛身體
                { child: "head",      parent: "body" },
                // 腿：大腿直接掛總根(不經過屁股/身體)、小腿掛大腿
                { child: "leg_up_L",  parent: BODY_NULL_NAME },
                { child: "leg_up_R",  parent: BODY_NULL_NAME },
                { child: "leg_low_L", parent: "leg_up_L" },
                { child: "leg_low_R", parent: "leg_up_R" }
                // 整隻沒拆的手臂/腿一律命名為上臂(arm_up)/大腿(leg_up),
                // 直接套用上面的 arm_up→body、leg_up→全身NULL 規則,不需另設後援。
            ]
        }
    };

    // 使用者自訂「骨架別名」：把圖層名稱前綴對應到骨架規則的 key(如 arm_up_L)。
    // 解決命名跟規則對不上的問題(例如圖層叫「左手臂」而規則找的是 arm_up_L)。
    var BONE_ALIAS_SEC = "CharacterPanel_BoneAlias";

    function boneAliasLoad() {
        var items = [];
        try {
            if (!app.settings.haveSetting(BONE_ALIAS_SEC, "count")) return [];
            var n = parseInt(app.settings.getSetting(BONE_ALIAS_SEC, "count"), 10) || 0;
            for (var i = 0; i < n; i++) {
                items.push({
                    pattern: decodeURIComponent(app.settings.getSetting(BONE_ALIAS_SEC, "pattern_" + i)),
                    key:     decodeURIComponent(app.settings.getSetting(BONE_ALIAS_SEC, "key_" + i))
                });
            }
        } catch (e) {}
        return items;
    }

    function boneAliasSave(items) {
        try {
            app.settings.saveSetting(BONE_ALIAS_SEC, "count", String(items.length));
            for (var i = 0; i < items.length; i++) {
                app.settings.saveSetting(BONE_ALIAS_SEC, "pattern_" + i, encodeURIComponent(items[i].pattern));
                app.settings.saveSetting(BONE_ALIAS_SEC, "key_" + i, encodeURIComponent(items[i].key));
            }
        } catch (e) {}
    }

    // 用 prefix 比對:圖層名稱以 pattern 開頭(不分大小寫)就算符合
    function layerMatchesPattern(layerName, pattern) {
        return layerName.toLowerCase().indexOf(pattern.toLowerCase()) === 0;
    }

    // 收集所有名稱以 pattern 開頭的圖層
    function findLayersByPrefix(comp, pattern) {
        var result = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            if (layerMatchesPattern(comp.layer(i).name, pattern)) result.push(comp.layer(i));
        }
        return result;
    }

    // 內建中文骨架別名:讓圖層直接用中文命名(身體/頭/左上臂…)也能對上骨架規則,
    // 不必再手動設別名。同一個 key 對到兩種命名(腰果式 armL1 / 樂樂式 arm_up_L)時都收。
    // pattern 用前綴比對(不分大小寫),所以「左上臂」「左上臂01」都算。
    var BUILTIN_BONE_ALIAS = [
        { pattern: "身體", key: "body" }, { pattern: "身体", key: "body" },
        { pattern: "屁股", key: "hip" },  { pattern: "臀",   key: "hip" },
        { pattern: "頭",   key: "head" }, { pattern: "头",   key: "head" },
        // 上臂(腰果式 armL1 / 樂樂式 arm_up_L 都對應)
        { pattern: "左上臂", key: "armL1" }, { pattern: "左上臂", key: "arm_up_L" }, { pattern: "左手臂", key: "arm_up_L" }, { pattern: "左手臂", key: "armL1" },
        { pattern: "右上臂", key: "armR1" }, { pattern: "右上臂", key: "arm_up_R" }, { pattern: "右手臂", key: "arm_up_R" }, { pattern: "右手臂", key: "armR1" },
        // 下臂(前臂)
        { pattern: "左下臂", key: "armL2" }, { pattern: "左下臂", key: "arm_low_L" }, { pattern: "左前臂", key: "arm_low_L" }, { pattern: "左前臂", key: "armL2" },
        { pattern: "右下臂", key: "armR2" }, { pattern: "右下臂", key: "arm_low_R" }, { pattern: "右前臂", key: "arm_low_R" }, { pattern: "右前臂", key: "armR2" },
        // 大腿
        { pattern: "左大腿", key: "legL1" }, { pattern: "左大腿", key: "leg_up_L" },
        { pattern: "右大腿", key: "legR1" }, { pattern: "右大腿", key: "leg_up_R" },
        // 小腿
        { pattern: "左小腿", key: "legL2" }, { pattern: "左小腿", key: "leg_low_L" },
        { pattern: "右小腿", key: "legR2" }, { pattern: "右小腿", key: "leg_low_R" }
    ];

    // 收集符合骨架 key 的圖層:內建前綴比對 + 內建中文別名 + 使用者自訂別名
    function findLayersByBoneKey(comp, key) {
        var result = findLayersByPrefix(comp, key);
        var aliases = BUILTIN_BONE_ALIAS.concat(boneAliasLoad());
        for (var i = 0; i < aliases.length; i++) {
            if (aliases[i].key !== key) continue;
            var extra = findLayersByPrefix(comp, aliases[i].pattern);
            for (var j = 0; j < extra.length; j++) {
                if (result.indexOf(extra[j]) === -1) result.push(extra[j]);
            }
        }
        return result;
    }

    // 建「全身NULL」並把位置放在角色腳底（取所有腿/腳圖層的最低點，水平取中）
    // 已存在就直接沿用。
    function ensureBodyNull(comp) {
        var existing = findLayer(comp, BODY_NULL_NAME);
        if (existing) return existing;

        // 找腳底：掃 leg_low / foot / 腳 圖層的 comp 座標最低點
        var footPrefixes = ["leg_low", "foot", "腳", "小腿"];
        var minBottomY = -Infinity, sumX = 0, cnt = 0, t = comp.time;
        for (var i = 1; i <= comp.numLayers; i++) {
            var lay = comp.layer(i);
            var nm = lay.name.toLowerCase();
            var isFoot = false;
            for (var p = 0; p < footPrefixes.length; p++) {
                if (nm.indexOf(footPrefixes[p].toLowerCase()) === 0) { isFoot = true; break; }
            }
            if (!isFoot) continue;
            try {
                var r = lay.sourceRectAtTime(t, false);
                // 底邊中點轉成 comp 座標
                var bottomMid = lay.toComp([r.left + r.width / 2, r.top + r.height]);
                if (bottomMid[1] > minBottomY) minBottomY = bottomMid[1];
                sumX += bottomMid[0]; cnt++;
            } catch (e) {}
        }

        var nullLay = comp.layers.addNull(comp.duration);
        nullLay.name = BODY_NULL_NAME;
        nullLay.moveToBeginning();
        // 錨點設在 Null 中心，位置放到腳底中點
        if (cnt > 0 && minBottomY > -Infinity) {
            var footX = sumX / cnt;
            var posProp = nullLay.property("ADBE Transform Group").property("ADBE Position");
            // Null 預設 100x100，錨點先置中
            nullLay.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([50, 50]);
            posProp.setValue([footX, minBottomY]);
        } else {
            // 找不到腳 → 放合成底部中央
            nullLay.property("ADBE Transform Group").property("ADBE Position")
                .setValue([comp.width / 2, comp.height]);
        }
        return nullLay;
    }

    function doSkeletonRig(presetKey) {
        var comp = activeComp(); if (!comp) return;
        var preset = SKELETON_PRESETS[presetKey];
        if (!preset) return;

        var chains = preset.chains;
        var linked = 0, skipped = [], notFound = [];

        app.beginUndoGroup("骨架綁定 " + presetKey);
        try {
            // 需要全身NULL的預設，先建好（這樣 chain 裡才找得到）
            if (preset.bodyNull) ensureBodyNull(comp);

            for (var c = 0; c < chains.length; c++) {
                var rule = chains[c];
                var children = findLayersByBoneKey(comp, rule.child);
                // 父圖層：全身NULL 用精確比對，其餘用前綴 + 使用者別名
                var parents;
                if (rule.parent === BODY_NULL_NAME) {
                    var bn = findLayer(comp, BODY_NULL_NAME);
                    parents = bn ? [bn] : [];
                } else {
                    parents = findLayersByBoneKey(comp, rule.parent);
                }

                if (children.length === 0) continue; // 此角色沒有這部位,跳過不算錯誤
                if (parents.length === 0)  { notFound.push(rule.child + "→" + rule.parent); continue; }

                var parentLay = parents[0];

                for (var i = 0; i < children.length; i++) {
                    var child = children[i];
                    if (child === parentLay) continue; // 別把自己 parent 給自己
                    if (child.parent) {
                        skipped.push(child.name);
                    } else {
                        child.parent = parentLay;
                        linked++;
                    }
                }
            }

            // 後援：沒有屁股圖層時，身體若還沒 parent，直接掛全身NULL
            if (preset.bodyNull) {
                var bn2 = findLayer(comp, BODY_NULL_NAME);
                var bodies = findLayersByBoneKey(comp, "body");
                for (var b = 0; b < bodies.length; b++) {
                    if (bn2 && !bodies[b].parent && bodies[b] !== bn2) {
                        bodies[b].parent = bn2; linked++;
                    }
                }
            }
        } finally { app.endUndoGroup(); }

        var msg = "骨架綁定完成！已串 " + linked + " 個圖層。\n";
        if (preset.bodyNull) msg += "（已建「" + BODY_NULL_NAME + "」放在腳底，當總控制點）\n";
        if (skipped.length)  msg += "\n已跳過(原本就有 parent):\n  " + skipped.join("、");
        if (notFound.length) msg += "\n找不到對應的父圖層:\n  " + notFound.join("、");
        if (linked === 0 && skipped.length === 0) {
            // 完全沒綁到 → 視為失敗,跳通知
            alert("找不到符合「" + presetKey + "」命名規則的圖層。\n" +
                  "圖層可用中文(身體/頭/左上臂/左大腿…)或英文命名;對不上時用命名頁的「綁定別名」補。");
        } else {
            showStatus(msg);
        }
    }

    // ================= UI =================

    function buildUI(thisObj) {
        var pal = (thisObj instanceof Panel) ? thisObj
                : new Window("palette", "角色工具 v2.0", undefined, { resizeable: true });

        pal.orientation = "column";
        pal.alignChildren = ["fill", "fill"];
        pal.spacing = 4; pal.margins = 6;

        // 分頁籤排版,壓低面板高度
        var tabs = pal.add("tabbedpanel");
        tabs.alignChildren = ["fill", "fill"];

        // ScriptUI 沒有原生捲軸 → 手工做:內容放在群組裡,
        // 分頁高度不夠時右側出現捲軸,拖動時把內容群組往上移
        var scrollTabs = [];
        function makeTab(title) {
            var tab = tabs.add("tab", undefined, title);
            tab.orientation = "row";
            tab.alignChildren = ["left", "top"];
            tab.margins = 6; tab.spacing = 2;
            var content = tab.add("group");
            content.orientation = "column";
            content.alignChildren = ["fill", "top"];
            content.spacing = 6;
            var sb = tab.add("scrollbar");
            sb.preferredSize.width = 14;
            sb.alignment = ["right", "fill"];
            sb.minvalue = 0; sb.maxvalue = 0; sb.value = 0;
            tab.__c = content; tab.__sb = sb; tab.__baseY = 0;
            sb.onChanging = function () {
                content.location = [content.location.x, Math.round(tab.__baseY - sb.value)];
            };
            scrollTabs.push(tab);
            return content;
        }

        // 依使用習慣固定分頁順序:改名稱 → 找父子層 → 標記 → 微動態 → 劇情動態 → 表達式。
        // 先把所有分頁建好(決定顯示順序),各功能區塊再填進對應分頁,不受程式碼撰寫順序影響。
        var TAB = {
            name: makeTab("命名"),
            rig:  makeTab("綁定"),
            mark: makeTab("標記"),
            dyn:  makeTab("動態(自動)"),
            perf: makeTab("演出(手動Key)"),
            expr: makeTab("表達式")
        };

        function updateScrollbars() {
            // 要用「面板實際高度」算可視範圍:被壓扁時 tab.size 回報的
            // 仍是排版需要的完整高度,用它判斷會永遠以為不用捲
            var paneH = 0;
            try { paneH = pal.size.height; } catch (e) {}
            if (!paneH) return;
            var headH = 46; // 分頁標籤列 + 邊距
            for (var i = 0; i < scrollTabs.length; i++) {
                var tab = scrollTabs[i], c = tab.__c, sb = tab.__sb;
                try {
                    if (sb.value === 0) tab.__baseY = c.location.y; // 只在未捲動時更新基準
                    var viewH = paneH - headH;
                    var overflow = c.size.height - viewH;
                    if (overflow > 0) {
                        sb.maxvalue = overflow + 12;
                        if (sb.value > sb.maxvalue) sb.value = sb.maxvalue;
                        sb.visible = true;
                        try { sb.size = [14, Math.max(viewH - 6, 40)]; } catch (e2) {}
                    } else {
                        sb.value = 0;
                        sb.visible = false;
                    }
                    c.location = [c.location.x, Math.round(tab.__baseY - sb.value)];
                } catch (e3) {}
            }
        }
        tabs.onChange = updateScrollbars;
        pal.__updateScroll = updateScrollbars;

        // 狀態列:顯示重複性操作(呼吸/漂浮…)的結果,不跳 alert
        statusLabel = pal.add("statictext", undefined, "就緒", { truncate: "end" });
        statusLabel.alignment = ["fill", "bottom"];

        // --- 標記 ---
        var p1 = TAB.mark;
        p1.add("statictext", undefined, "先選圖層再按按鈕:  [v2.0]");
        var rowA = p1.add("group"); var rowB = p1.add("group");
        var tagOrder = ["閉眼", "睜眼", "閉嘴", "開嘴", "說話嘴", "眉", "特效", "耳", "鼻"];
        var fullRigCheck;
        for (var i = 0; i < tagOrder.length; i++) {
            var row = (i < 4) ? rowA : rowB;
            (function (base) {
                var b = row.add("button", undefined, base);
                b.preferredSize.width = (base.length > 2) ? 64 : 52;
                b.onClick = function () { doTag(base, fullRigCheck.value); };
            })(tagOrder[i]);
        }
        var bSpec = rowB.add("button", undefined, "特殊…");
        bSpec.preferredSize.width = 52;
        bSpec.onClick = doSpecialTag;

        var rowNum = p1.add("group");
        var bNum = rowNum.add("button", undefined, "編號狀態…");
        bNum.preferredSize.width = 86;
        bNum.onClick = doNumberedTag;
        fullRigCheck = p1.add("checkbox", undefined, "完整綁定(建 face/eye/mouth/ear Null 並 parent)");
        fullRigCheck.value = false;

        // ── 生成五官佔位(只畫形狀,不綁滑桿;畫好/調好後自己選取它再點上面的標記按鈕)──
        p1.add("statictext", undefined, "生成佔位(只畫形狀、不綁滑桿;畫好後選取它再點標記按鈕):");
        var rowGen = p1.add("group");
        var bGenMouth = rowGen.add("button", undefined, "補開嘴");  bGenMouth.preferredSize.width = 60;
        var bGenClose = rowGen.add("button", undefined, "補閉嘴");  bGenClose.preferredSize.width = 60;
        var bGenEye  = rowGen.add("button", undefined, "補睜眼");   bGenEye.preferredSize.width = 60;
        var bGenCEye = rowGen.add("button", undefined, "補閉眼");   bGenCEye.preferredSize.width = 60;
        var bGenBrow = rowGen.add("button", undefined, "補眉");     bGenBrow.preferredSize.width = 52;
        bGenMouth.onClick = doGenOpenMouth;
        bGenClose.onClick = doGenClosedMouth;
        bGenEye.onClick   = doGenEyesOpen;
        bGenCEye.onClick  = doGenClosedEye;
        bGenBrow.onClick  = doGenBrows;

        // --- 命名 / 控制 NULL ---
        var p5 = TAB.name;

        // ── 顯示模式 ＋ 中英轉換(同一列)──────────────────────
        var rowMode = p5.add("group");
        rowMode.add("statictext", undefined, "按鈕顯示:");
        var radShowZh = rowMode.add("radiobutton", undefined, "中文");
        var radShowEn = rowMode.add("radiobutton", undefined, "英文");
        radShowZh.value = true;
        function showEn() { return radShowEn.value; }

        // 中英轉換:範圍開關 + 兩顆按鈕,跟「按鈕顯示」併同一列
        rowMode.add("statictext", undefined, "  轉換:");
        var radScopeSel = rowMode.add("radiobutton", undefined, "選取");
        var radScopeAll = rowMode.add("radiobutton", undefined, "全comp");
        radScopeSel.value = true;
        function convScope(dir) {
            if (radScopeAll.value) doConvertAll(dir);
            else                   doConvertSelected(dir);
        }
        var bToEn = rowMode.add("button", undefined, "轉英文"); bToEn.preferredSize.width = 64;
        var bToZh = rowMode.add("button", undefined, "轉中文"); bToZh.preferredSize.width = 64;
        bToEn.onClick = function () { convScope("toEn"); };
        bToZh.onClick = function () { convScope("toZh"); };

        // ── 分類按鈕區 ────────────────────────────────────────
        // 從 NAME_MAP 抽出所有 category（保持順序、不重複）
        function getCategories(items) {
            var cats = [], seen = {};
            for (var i = 0; i < items.length; i++) {
                var c = items[i].cat || "其他";
                if (!seen[c]) { seen[c] = true; cats.push(c); }
            }
            return cats;
        }

        var nameGrid = p5.add("group");
        nameGrid.orientation = "column"; nameGrid.alignChildren = ["fill", "top"]; nameGrid.spacing = 2;

        // 依面板寬度算每行放幾個按鈕（扣掉分類標籤的寬度）
        function colsPerRow() {
            var w = 380;
            try { if (pal.size && pal.size.width) w = pal.size.width; } catch (e) {}
            var per = Math.floor((w - 70) / 60); // 70=標籤+邊距, 60=按鈕寬+間距
            if (per < 3) per = 3;
            if (per > 12) per = 12;
            return per;
        }

        // 建一列：開頭放分類標籤，後面接該分類的按鈕（超過 per 個才換行續接）
        function addCategoryRow(catLabel, items) {
            var per = colsPerRow();
            var row = null;
            for (var j = 0; j < items.length; j++) {
                if (j % per === 0) {
                    row = nameGrid.add("group");
                    row.spacing = 2; row.alignment = ["left", "top"];
                    var lab = row.add("statictext", undefined, (j === 0 ? catLabel : ""));
                    lab.preferredSize.width = 42;
                }
                (function (entry) {
                    var lbl = showEn() ? entry.en : entry.zh;
                    var b = row.add("button", undefined, lbl);
                    b.preferredSize.width = 56;
                    b.onClick = function () { doRenameItem(entry, showEn()); };
                })(items[j]);
            }
        }

        // 「配件2」(眼鏡/圍巾/項鍊/翅膀/寶石/鈕扣/鞋/線等較少用配件)預設收合,
        // 用一顆「更多配件 ▾/▴」按鈕展開/收合,避免命名頁一長串。
        var moreAccessoriesOpen = false;

        function rebuildNames() {
            while (nameGrid.children.length > 0) nameGrid.remove(nameGrid.children[0]);
            // 只用內建對照分類(自訂項目另列在「自訂」,不再混進「其他」)
            var allItems = NAME_MAP;
            var cats = getCategories(allItems);
            for (var c = 0; c < cats.length; c++) {
                var cat = cats[c];
                if (cat === "配件2") continue; // 另外處理(收合區塊)
                var catItems = [];
                for (var k = 0; k < allItems.length; k++) {
                    if ((allItems[k].cat || "其他") === cat) catItems.push(allItems[k]);
                }
                addCategoryRow(cat, catItems);
            }

            // ── 更多配件(收合區塊)──
            var moreItems = [];
            for (var m = 0; m < allItems.length; m++) {
                if ((allItems[m].cat || "其他") === "配件2") moreItems.push(allItems[m]);
            }
            if (moreItems.length > 0) {
                var rowToggle = nameGrid.add("group");
                var bToggle = rowToggle.add("button", undefined, moreAccessoriesOpen ? "更多配件 ▴" : "更多配件 ▾");
                bToggle.preferredSize.width = 90;
                bToggle.onClick = function () {
                    moreAccessoriesOpen = !moreAccessoriesOpen;
                    rebuildNames();
                };
                if (moreAccessoriesOpen) addCategoryRow("", moreItems);
            }

            // 自訂項目單獨一列
            var customs = nameMapLoad();
            if (customs.length > 0) addCategoryRow("自訂", customs);

            pal.layout.layout(true);
            updateScrollbars();
        }
        rebuildNames();
        radShowZh.onClick = function () { rebuildNames(); };
        radShowEn.onClick = function () { rebuildNames(); };

        // ── 自訂對照 ──────────────────────────────────────────
        var rowNm = p5.add("group");
        var bNmAdd = rowNm.add("button", undefined, "+ 新增對照"); bNmAdd.preferredSize.width = 90;
        var bNmDel = rowNm.add("button", undefined, "− 刪除對照"); bNmDel.preferredSize.width = 90;
        bNmAdd.onClick = function () {
            var zh = prompt("中文名稱:", "");   if (!zh) return;
            var en = prompt("對應英文:", "");   if (!en) return;
            var customs = nameMapLoad();
            customs.push({ zh: zh, en: en });
            nameMapSave(customs);
            rebuildNames();
        };
        bNmDel.onClick = function () {
            var zh = prompt("要刪除的中文名稱:", ""); if (!zh) return;
            var customs = nameMapLoad();
            for (var i = 0; i < customs.length; i++) {
                if (customs[i].zh === zh) {
                    customs.splice(i, 1); nameMapSave(customs); rebuildNames(); return;
                }
            }
            alert("自訂清單裡沒有「" + zh + "」。\n(內建項目無法刪除)");
        };


        // ====== 綁定分頁（控制 NULL / 骨架 / 錨點）======
        var p6 = TAB.rig;

        // ── 建立角色 control（含常用滑桿）──────────────────────
        var rowCtl = p6.add("group");
        var labCtl = rowCtl.add("statictext", undefined, "Control:"); labCtl.preferredSize.width = 70;
        var bCtl = rowCtl.add("button", undefined, "建 control(含常用滑桿)");
        bCtl.preferredSize.width = 160;
        bCtl.onClick = function () {
            var comp = activeComp(); if (!comp) return;
            app.beginUndoGroup("建 control");
            try { ensureControl(comp); } finally { app.endUndoGroup(); }
            showStatus("control 已就緒:eye / mouth / 眉 / emo 滑桿 + face position 點控制。" +
                  "(已存在的話只補缺少的滑桿,不會動到既有 key)");
        };

        // ── 控制 NULL（標籤 + 兩按鈕同列）─────────────────────
        var rowNu = p6.add("group");
        var labNu = rowNu.add("statictext", undefined, "控制NULL:"); labNu.preferredSize.width = 70;
        var bNuEach   = rowNu.add("button", undefined, "各建");     bNuEach.preferredSize.width = 70;
        var bNuShared = rowNu.add("button", undefined, "共用一個"); bNuShared.preferredSize.width = 90;
        bNuEach.onClick = doNullEach;
        bNuShared.onClick = doNullShared;

        // ── 骨架自動 parent（標籤 + 按鈕同列）──────────────────
        var rowRig = p6.add("group");
        var labRig = rowRig.add("statictext", undefined, "骨架:"); labRig.preferredSize.width = 70;
        var bRig = rowRig.add("button", undefined, "一鍵綁定父子"); bRig.preferredSize.width = 130;
        bRig.onClick = function () { doSkeletonRig("樂樂式"); };
        var bRigInfo = rowRig.add("button", undefined, "?"); bRigInfo.preferredSize.width = 28;
        bRigInfo.onClick = function () {
            alert("骨架父子規則（樂樂式）:\n\n" +
                  "全身NULL（自動建,放腳底）= 總根\n" +
                  "  屁股(hip)    → 全身NULL\n" +
                  "  身體(body)   → 屁股\n" +
                  "  大腿(leg_up) → 全身NULL（不經過身體）\n" +
                  "  小腿(leg_low)→ 大腿\n" +
                  "  上臂(arm_up) → 身體\n" +
                  "  下臂(arm_low)→ 上臂\n" +
                  "  頭(head)     → 身體\n\n" +
                  "整隻沒拆的手臂/腿,命名為「上臂(arm_up)/大腿(leg_up)」即可,\n" +
                  "會直接套用上面的規則,不必特別處理。\n" +
                  "沒有屁股圖層時,身體會直接掛全身NULL。\n" +
                  "先在命名頁把名稱轉成英文,再按此按鈕效果最佳。\n" +
                  "已有 parent 的圖層不會被覆蓋。\n\n" +
                  "圖層名稱跟規則對不上?用下面的「綁定別名」\n" +
                  "告訴面板你的某個前綴對應到哪個規則 key。");
        };

        // ── 零件綁定:選取的零件自動掛到下方畫面重疊比例最高的圖層(對照表/骨架涵蓋不到的雜項)──
        var rowPart = p6.add("group");
        var labPart = rowPart.add("statictext", undefined, "零件:"); labPart.preferredSize.width = 70;
        var bPart = rowPart.add("button", undefined, "依重疊自動綁父層"); bPart.preferredSize.width = 130;
        bPart.onClick = doAutoParentByOverlap;
        var rowPart2 = p6.add("group");
        rowPart2.add("statictext", undefined, "").preferredSize.width = 70;
        rowPart2.add("statictext", undefined, "選零件(褲子線/寶石/包包…),自動綁到畫面重疊最多的圖層(不限上下,已有parent的會跳過)");

        // ── 五官綁到 face null(五官沒在頭部 comp 時用)──
        var rowFace = p6.add("group");
        rowFace.add("statictext", undefined, "五官:").preferredSize.width = 70;
        var bFaceNull = rowFace.add("button", undefined, "綁五官到 face null"); bFaceNull.preferredSize.width = 130;
        bFaceNull.onClick = doBindFaceNull;
        var rowFace2 = p6.add("group");
        rowFace2.add("statictext", undefined, "").preferredSize.width = 70;
        rowFace2.add("statictext", undefined, "五官沒在頭部comp時用,建好後自己把 face 接到頭或身體");

        // ── 綁定別名(使用者自訂命名 → 骨架規則 key)───────────
        var rowAlias = p6.add("group");
        var labAlias = rowAlias.add("statictext", undefined, "綁定別名:"); labAlias.preferredSize.width = 70;
        var bAliasAdd = rowAlias.add("button", undefined, "+ 新增"); bAliasAdd.preferredSize.width = 70;
        var bAliasDel = rowAlias.add("button", undefined, "− 刪除"); bAliasDel.preferredSize.width = 70;
        var bAliasList = rowAlias.add("button", undefined, "清單"); bAliasList.preferredSize.width = 50;
        bAliasAdd.onClick = function () {
            var pattern = prompt("圖層名稱前綴(例如:左手臂):", "");
            if (!pattern) return;
            var key = prompt(
                "對應到哪個骨架規則 key?\n" +
                "常用:body / hip / head /\n" +
                "arm_up_L / arm_up_R / arm_low_L / arm_low_R /\n" +
                "leg_up_L / leg_up_R / leg_low_L / leg_low_R",
                "arm_up_L");
            if (!key) return;
            var items = boneAliasLoad();
            items.push({ pattern: pattern, key: key });
            boneAliasSave(items);
            showStatus("已新增綁定別名:「" + pattern + "」→ " + key);
        };
        bAliasDel.onClick = function () {
            var pattern = prompt("要刪除的別名前綴:", ""); if (!pattern) return;
            var items = boneAliasLoad();
            for (var i = 0; i < items.length; i++) {
                if (items[i].pattern === pattern) {
                    items.splice(i, 1); boneAliasSave(items);
                    showStatus("已刪除綁定別名:「" + pattern + "」");
                    return;
                }
            }
            alert("找不到前綴「" + pattern + "」的別名。");
        };
        bAliasList.onClick = function () {
            var items = boneAliasLoad();
            if (items.length === 0) { alert("目前沒有自訂綁定別名。"); return; }
            var lines = [];
            for (var i = 0; i < items.length; i++) lines.push(items[i].pattern + " → " + items[i].key);
            alert("目前的綁定別名:\n" + lines.join("\n"));
        };

        // --- 動態(自動微動,跑整部影片不用人工) ---
        var p2 = TAB.dyn;
        p2.add("statictext", undefined, "套用後自動循環播放,不用打 key(眨眼/說話開合/呼吸/漂浮/擺動):");
        var rowC = p2.add("group"); var rowD = p2.add("group");
        var bBlink = rowC.add("button", undefined, "隨機眨眼");   bBlink.preferredSize.width = 110;
        var bTalk  = rowC.add("button", undefined, "說話設定");   bTalk.preferredSize.width = 110;
        var bBr    = rowD.add("button", undefined, "呼吸(選取)"); bBr.preferredSize.width = 110;
        var bFl    = rowD.add("button", undefined, "漂浮(選取)"); bFl.preferredSize.width = 110;
        var bSway  = rowD.add("button", undefined, "擺動(選取)"); bSway.preferredSize.width = 110;
        var bSwayR = rowD.add("button", undefined, "擺動反向"); bSwayR.preferredSize.width = 90;
        bSwayR.helpTip = "相位相反的擺動。對另一組圖層套這個,就會跟正向擺動的圖層左右交錯。";
        bBlink.onClick = doBlink;
        bTalk.onClick  = doTalkSetup;
        bBr.onClick    = doBreath;
        bFl.onClick    = doFloat;
        bSway.onClick  = function () { doSway(1); };
        bSwayR.onClick = function () { doSway(-1); };

        p2.add("statictext", undefined, "節奏(用數字調,不用憑感覺拉 key):");
        var rowRt = p2.add("group");
        var bLoopT = rowRt.add("button", undefined, "循環 key 節奏…"); bLoopT.preferredSize.width = 110;
        var bExprT = rowRt.add("button", undefined, "表達式倍速…");   bExprT.preferredSize.width = 110;
        var bExprA = rowRt.add("button", undefined, "表達式倍幅…");   bExprA.preferredSize.width = 110;
        bLoopT.onClick = retimeLoopKeys;
        bExprT.onClick = retimeExprSpeed;
        bExprA.onClick = retimeExprAmp;
        p2.add("statictext", undefined, "倍速=改快慢(speed/period/wiggle頻率);倍幅=改動多大(amp/wiggle幅度)。覺得沒差就調倍幅。");

        // --- 演出(手動下 key:人待在主場景,key 寫進角色的 control) ---
        var p3 = TAB.perf;

        var rigComps = [];
        var rowChar = p3.add("group");
        rowChar.add("statictext", undefined, "角色:");
        var charDrop = rowChar.add("dropdownlist", undefined, []);
        charDrop.preferredSize.width = 150;
        var bScan = rowChar.add("button", undefined, "↻"); bScan.preferredSize.width = 30;

        // 找「直接引用 comp 當圖層來源」的上層合成名稱(通常就是角色 precomp);
        // 用來在多個角色的頭合成都叫 head 時,加前綴區分(例:小明 ▸ head)。
        function ownerCompName(comp) {
            try {
                for (var i = 1; i <= app.project.numItems; i++) {
                    var c = app.project.item(i);
                    if (!(c instanceof CompItem) || c === comp) continue;
                    for (var j = 1; j <= c.numLayers; j++) {
                        if (c.layer(j).source === comp) return c.name;
                    }
                }
            } catch (e) {}
            return null;
        }

        function refreshRigComps() {
            rigComps = [];
            charDrop.removeAll();
            try {
                // 先掃出所有含 control 的合成,並統計同名次數
                var nameCount = {};
                for (var i = 1; i <= app.project.numItems; i++) {
                    var it = app.project.item(i);
                    if (it instanceof CompItem && findLayer(it, "control")) {
                        rigComps.push(it);
                        nameCount[it.name] = (nameCount[it.name] || 0) + 1;
                    }
                }
                for (var k = 0; k < rigComps.length; k++) {
                    var rc = rigComps[k];
                    var label;
                    if (nameCount[rc.name] > 1) {
                        // 重名(多個 head…)→ 用引用它的角色合成名當前綴
                        var owner = ownerCompName(rc);
                        label = owner ? (owner + " ▸ " + rc.name) : (rc.name + " #" + (k + 1));
                    } else {
                        var folder = (rc.parentFolder && rc.parentFolder.name !== "Root")
                                   ? "  [" + rc.parentFolder.name + "]" : "";
                        label = rc.name + folder;
                    }
                    charDrop.add("item", label);
                }
            } catch (e) {}
            if (charDrop.items.length > 0) charDrop.selection = 0;
        }
        refreshRigComps();
        bScan.onClick = refreshRigComps;

        // ── 鎖定角色:在外層合成選取角色圖層即可,control 不必在角色 precomp 的第一層 ──
        // 會自動往內挖(角色 precomp → 頭 precomp …)找到含 control 的合成,
        // 下 key 時自動把外層時間換算成該角色內部合成的時間,不用切進頭合成。
        // 若目前合成本身就有 control(無頭層結構),也可不選圖層直接鎖目前合成。
        // layerChain:從外層選取圖層往內、到含 control 那層之間的圖層串(外→內);空陣列=直接鎖目前合成。
        var lockedTarget = null; // { comp, layerChain:[...] }
        var rowLock = rowChar;   // 跟「角色」下拉同一列
        var bLock = rowLock.add("button", undefined, "選取圖層"); bLock.preferredSize.width = 80;
        var bUnlock = rowLock.add("button", undefined, "解除"); bUnlock.preferredSize.width = 50;
        var bCtrlFx = rowLock.add("button", undefined, "C"); bCtrlFx.preferredSize.width = 28;
        bCtrlFx.helpTip = "開啟目前角色 control 的特效面板:自動進到 control 所在合成、選取它,並叫出左邊的 Effect Controls,跟手動點進去一樣。";
        var lockLabel = rowLock.add("statictext", undefined, "(用左側下拉)");
        lockLabel.preferredSize.width = 110;
        bLock.onClick = function () {
            var c = app.project.activeItem;
            if (!(c instanceof CompItem)) { alert("先點開外層合成,選取角色圖層再按此按鈕。"); return; }
            var sel = c.selectedLayers;
            if (sel.length > 0 && sel[0].source instanceof CompItem) {
                // 往內挖最多 6 層,找到含 control 的合成(control 可能在頭 precomp 裡)
                var r = findControlChain(sel[0].source, 6);
                if (r) {
                    lockedTarget = { comp: r.comp, layerChain: [sel[0]].concat(r.chain) };
                    lockLabel.text = "已鎖定:「" + sel[0].name + "」(control 在:" + r.comp.name + ")";
                    return;
                }
            }
            if (findLayer(c, "control")) {
                lockedTarget = { comp: c, layerChain: [] };
                lockLabel.text = "已鎖定:目前合成「" + c.name + "」本身(無頭層結構)";
                return;
            }
            alert("找不到可鎖定的角色。\n" +
                  "請在外層合成選取一個角色圖層(它的來源合成裡、或更內層含有 control),\n" +
                  "或直接打開角色本身就有 control 的合成(無頭層結構)。\n\n" +
                  "提示:control 圖層名稱必須剛好是「control」(英文小寫),面板才認得;\n" +
                  "角色圖層本身叫什麼名字(中文英文都行)沒關係。");
        };
        bUnlock.onClick = function () {
            lockedTarget = null;
            lockLabel.text = "(用左側下拉)";
        };

        // 鎖定的圖層串可能被使用者刪掉/換掉,存取前先確認最外層那個還活著。失效就自動解鎖。
        function lockedLayerAlive() {
            if (!(lockedTarget && lockedTarget.layerChain && lockedTarget.layerChain.length)) return false;
            try {
                var _ = lockedTarget.layerChain[0].containingComp; // 已刪除的圖層存取會丟錯
                return true;
            } catch (e) {
                lockedTarget = null;
                lockLabel.text = "(鎖定的圖層已失效,已自動解鎖)";
                return false;
            }
        }

        function targetComp() {
            if (lockedTarget) {
                if (lockedTarget.layerChain.length && !lockedLayerAlive()) {
                    // 圖層失效後 lockedTarget 已被清空,落回下拉選單
                } else {
                    return lockedTarget.comp;
                }
            }
            if (!charDrop.selection) { alert("先按 ↻ 掃描專案,再從下拉選角色(有 control 的合成),\n或用「鎖定選取角色圖層」。"); return null; }
            return rigComps[charDrop.selection.index];
        }

        // 一鍵叫出 control 的 Effect Controls:進到 control 所在合成、選取它,並開啟特效控制面板。
        // 等同手動點進角色裡選 control,但不用自己挖層級。
        bCtrlFx.onClick = function () {
            var tc = targetComp(); if (!tc) return;
            var ctrl = findLayer(tc, "control");
            if (!ctrl) { alert("這個角色的合成「" + tc.name + "」裡找不到名為 control 的圖層。"); return; }
            try { tc.openInViewer(); } catch (eO) {}        // 把 control 所在合成開到前景
            try {
                for (var i = 1; i <= tc.numLayers; i++) tc.layer(i).selected = false;
                ctrl.selected = true;                        // 只選 control
            } catch (eS) {}
            // 叫出 Effect Controls 面板(選取 control 後它就會顯示 control 的滑桿)
            var opened = false;
            try {
                var id = app.findMenuCommandId("Effect Controls");  // 各語系名稱不同時可能找不到
                if (id) { app.executeCommandId(id); opened = true; }
            } catch (eM) {}
            if (!opened) { try { app.executeCommandId(2163); opened = true; } catch (eC) {} } // 常見的 Effect Controls 指令 ID
            showStatus(opened
                ? "已選取「" + tc.name + "」的 control 並叫出 Effect Controls 面板。"
                : "已選取「" + tc.name + "」的 control。若左側沒跳出 Effect Controls,按一下 F3 或 Window 選單開啟即可。");
        };

        // 用「目前開著的合成」的時間下 key(你們所有合成都是同一條全片時間軸)
        // 若鎖定的是外層合成裡的角色層,沿著 layerChain 一路把外層時間換算成最內層 control 合成的時間。
        function nowTime(tc) {
            if (lockedLayerAlive()) {
                var chain = lockedTarget.layerChain;
                var a = app.project.activeItem;
                var t = (a instanceof CompItem) ? a.time : chain[0].containingComp.time;
                for (var i = 0; i < chain.length; i++) {
                    t = (t - chain[i].startTime) * 100 / chain[i].stretch;
                }
                return t;
            }
            var a2 = app.project.activeItem;
            return (a2 instanceof CompItem) ? a2.time : tc.time;
        }

        function remoteKey(role, val) {
            var tc = targetComp(); if (!tc) return;
            app.beginUndoGroup("演出 key:" + role);
            try {
                ensureControl(tc);
                var sliderName = sliderNameFor(tc, role); // 自動沿用該角色的滑桿名(眼 or eye)
                var slider = findLayer(tc, "control")
                    .property("ADBE Effect Parade").property(sliderName).property(1);
                var t = nowTime(tc);
                // 第一顆 key 之前的時間會「跟隨」該 key 的值 → 在 0 秒先補一個靜止 key(值 0)
                // 這樣 key 之前(不該講話/不該閉眼時)會維持 0,不會提早開始。
                if (slider.numKeys === 0 && t > 0) {
                    slider.setValueAtTime(0, 0);
                    var k0 = slider.nearestKeyIndex(0);
                    slider.setInterpolationTypeAtKey(k0,
                        KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
                }
                slider.setValueAtTime(t, val);
                var k = slider.nearestKeyIndex(t);
                slider.setInterpolationTypeAtKey(k,
                    KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
            } finally { app.endUndoGroup(); }
        }

        var rowT = p3.add("group");
        rowT.add("statictext", undefined, "說話:");
        var bOn  = rowT.add("button", undefined, "▶ 開始說話"); bOn.preferredSize.width = 110;
        var bOff = rowT.add("button", undefined, "■ 停止說話"); bOff.preferredSize.width = 110;
        bOn.onClick  = function () { var tc = targetComp(); if (!tc) return; remoteKey("mouth", talkValue(tc)); };
        bOff.onClick = function () { remoteKey("mouth", 0); };

        // 通用表情/狀態列(一排涵蓋眼/嘴/眉/emo):選五官 → 值下拉自動列出對應圖層 → 下 HOLD key。
        // 不用點進 control,從最外層即可切換所有滑桿狀態。
        var GEN_ROLES = [
            { label: "眼", role: "eye" },
            { label: "嘴", role: "mouth" },
            { label: "眉", role: "眉" },
            { label: "emo", role: "emo" }
        ];
        var rowGen = p3.add("group");
        rowGen.add("statictext", undefined, "表情:");
        var roleDrop = rowGen.add("dropdownlist", undefined, []);
        roleDrop.preferredSize.width = 56;
        for (var gr = 0; gr < GEN_ROLES.length; gr++) roleDrop.add("item", GEN_ROLES[gr].label);
        roleDrop.selection = 1; // 預設嘴
        var valDrop = rowGen.add("dropdownlist", undefined, []);
        valDrop.preferredSize.width = 180;
        var bGenScan = rowGen.add("button", undefined, "↻"); bGenScan.preferredSize.width = 30;
        var bGenSet  = rowGen.add("button", undefined, "下 HOLD key"); bGenSet.preferredSize.width = 100;
        var genShapes = [];
        function curGenTarget() {
            return (lockedTarget ? lockedTarget.comp :
                    (charDrop.selection ? rigComps[charDrop.selection.index] : null));
        }
        function refreshGenDrop() {
            genShapes = [];
            valDrop.removeAll();
            var tc = curGenTarget();
            if (!tc || !roleDrop.selection) return;
            try {
                genShapes = listSliderShapes(tc, GEN_ROLES[roleDrop.selection.index].role);
                for (var i = 0; i < genShapes.length; i++) valDrop.add("item", genShapes[i].label);
                if (valDrop.items.length > 0) valDrop.selection = 0;
            } catch (e) {}
        }
        refreshGenDrop();
        roleDrop.onChange = function () { refreshGenDrop(); };
        bGenScan.onClick = refreshGenDrop;
        charDrop.onChange = function () { refreshGenDrop(); };
        // 重新掃描角色時順手刷新值下拉
        bScan.onClick = function () { refreshRigComps(); refreshGenDrop(); };
        bGenSet.onClick = function () {
            var tc = targetComp(); if (!tc) return;
            if (!(valDrop.selection && genShapes[valDrop.selection.index])) { alert("先按 ↻ 掃描,再從值下拉選一個。"); return; }
            remoteKey(GEN_ROLES[roleDrop.selection.index].role, genShapes[valDrop.selection.index].val);
        };

        // ── 演出快捷鍵(對「目前合成裡選取的圖層」下 key,在哪一層都能用)──────────────
        p3.add("statictext", undefined, "演出快捷鍵(嚇一跳/翻轉/閃爍):在任一合成選取圖層即可,沒選才用上面鎖定的角色:");
        var rowShort = p3.add("group");
        var bShock = rowShort.add("button", undefined, "嚇一跳"); bShock.preferredSize.width = 70;
        var bFlip  = rowShort.add("button", undefined, "左右翻轉"); bFlip.preferredSize.width = 70;
        var bFlash = rowShort.add("button", undefined, "閃爍"); bFlash.preferredSize.width = 70;

        // 步態循環:打一組「上下浮動+左右微傾」關鍵幀,自己複製接成整段,平移自己拉
        p3.add("statictext", undefined, "步態(打一組關鍵幀,框選複製接成整段,水平平移自己拉):");
        var rowGait = p3.add("group");
        var bWalk = rowGait.add("button", undefined, "走路循環"); bWalk.preferredSize.width = 110;
        var bRun  = rowGait.add("button", undefined, "跑步循環"); bRun.preferredSize.width = 110;
        bWalk.helpTip = "在選取圖層 Position(上下彈)+Rotation(左右微傾)打一個步態循環的 key,可框選複製貼上接成整段。";
        bRun.helpTip  = "同走路循環,彈跳更大、循環更快。";
        bWalk.onClick  = function () { doWalkCycle("走路"); };
        bRun.onClick   = function () { doWalkCycle("跑步"); };

        // 取要套快捷鍵的圖層:優先用目前合成選取的圖層(可複選),沒選才退回已鎖定的角色層。
        function performTargets() {
            var a = app.project.activeItem;
            if (a instanceof CompItem && a.selectedLayers.length) return a.selectedLayers;
            if (lockedLayerAlive()) return [lockedTarget.layerChain[0]];
            alert("先在目前合成選取要套用的圖層(可複選),\n或在上面「鎖定選取角色圖層」。");
            return null;
        }

        bShock.onClick = function () {
            var targets = performTargets(); if (!targets) return;
            app.beginUndoGroup("演出:嚇一跳");
            try {
                for (var n = 0; n < targets.length; n++) {
                    var scale = targets[n].property("ADBE Transform Group").property("ADBE Scale");
                    var t = targets[n].containingComp.time;
                    var base = scale.valueAtTime(t, false);
                    var big = [base[0] * 1.2, base[1] * 1.2];
                    scale.setValueAtTime(t, base);
                    scale.setValueAtTime(t + 0.08, big);
                    scale.setValueAtTime(t + 0.20, base);
                }
            } finally { app.endUndoGroup(); }
            showStatus("已對 " + targets.length + " 個圖層加入「嚇一跳」縮放動畫(目前時間附近)。");
        };

        bFlip.onClick = function () {
            var targets = performTargets(); if (!targets) return;
            app.beginUndoGroup("演出:左右翻轉");
            try {
                for (var n = 0; n < targets.length; n++) {
                    var scale = targets[n].property("ADBE Transform Group").property("ADBE Scale");
                    var t = targets[n].containingComp.time;
                    var base = scale.valueAtTime(t, false);
                    var flipped = [-base[0], base[1]];
                    if (base.length > 2) flipped.push(base[2]);
                    scale.setValueAtTime(t, flipped);
                    var k = scale.nearestKeyIndex(t);
                    scale.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
                }
            } finally { app.endUndoGroup(); }
            showStatus("已對 " + targets.length + " 個圖層下「左右翻轉」HOLD key(Scale X 正負互換)。");
        };

        bFlash.onClick = function () {
            var targets = performTargets(); if (!targets) return;
            app.beginUndoGroup("演出:閃爍");
            try {
                for (var n = 0; n < targets.length; n++) {
                    var op = targets[n].property("ADBE Transform Group").property("ADBE Opacity");
                    var t = targets[n].containingComp.time;
                    var base = op.valueAtTime(t, false);
                    var seq = [base, 20, base, 20, base];
                    for (var i = 0; i < seq.length; i++) {
                        var kt = t + i * 0.06;
                        op.setValueAtTime(kt, seq[i]);
                        var k = op.nearestKeyIndex(kt);
                        op.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
                    }
                }
            } finally { app.endUndoGroup(); }
            showStatus("已對 " + targets.length + " 個圖層加入「閃爍」不透明度 HOLD key 序列(目前時間附近)。");
        };

        // --- 表達式工具 ---
        var p4 = TAB.expr;

        var rowProp = p4.add("group");
        rowProp.add("statictext", undefined, "套在:");
        var propDrop = rowProp.add("dropdownlist", undefined, (function () {
            var a = [];
            for (var i = 0; i < PROP_CHOICES.length; i++) a.push(PROP_CHOICES[i].label);
            return a;
        })());
        propDrop.selection = 0;
        rowProp.add("statictext", undefined, "(反白屬性優先)");

        var rowE1 = p4.add("group");
        var bPing  = rowE1.add("button", undefined, "pingpong");  bPing.preferredSize.width = 80;
        var bCycle = rowE1.add("button", undefined, "cycle");     bCycle.preferredSize.width = 80;
        var bWig   = rowE1.add("button", undefined, "wiggle…");   bWig.preferredSize.width = 80;
        var bClear = rowE1.add("button", undefined, "清除");      bClear.preferredSize.width = 60;

        bPing.onClick  = function () { applyExprToSelection('loopOut("pingpong")', propDrop.selection.index, "套用 pingpong"); };
        bCycle.onClick = function () { applyExprToSelection('loopOut("cycle")',    propDrop.selection.index, "套用 cycle"); };
        bWig.onClick   = function () {
            var f = parseFloat(prompt("wiggle 頻率(每秒幾次):", "2"));  if (isNaN(f)) return;
            var a = parseFloat(prompt("wiggle 幅度:", "10"));            if (isNaN(a)) return;
            applyExprToSelection("wiggle(" + f + ", " + a + ")", propDrop.selection.index, "套用 wiggle");
        };
        bClear.onClick = function () { applyExprToSelection("", propDrop.selection.index, "清除表達式"); };

        var customBox = p4.add("edittext", undefined, "", { multiline: true });
        customBox.preferredSize.height = 64;
        var rowE2 = p4.add("group");
        var bCustom = rowE2.add("button", undefined, "套用自訂表達式"); bCustom.preferredSize.width = 140;
        bCustom.onClick = function () {
            var txt = customBox.text;
            if (!txt || txt.replace(/\s/g, "") === "") { alert("先在上面的框貼入表達式。"); return; }
            applyExprToSelection(txt, propDrop.selection.index, "套用自訂表達式");
        };

        // --- 常用表達式庫 ---
        p4.add("statictext", undefined, "我的常用表達式(點一下=載入上面的框,雙擊=直接套用):");
        var libItems = libLoad();
        var rowLib = p4.add("group"); rowLib.alignChildren = ["fill", "fill"];
        var libList = rowLib.add("listbox", undefined, []);
        libList.preferredSize = [170, 84];
        var libBtns = rowLib.add("group");
        libBtns.orientation = "column"; libBtns.alignChildren = ["fill", "top"];
        var bLibApply = libBtns.add("button", undefined, "套用");
        var bLibAdd   = libBtns.add("button", undefined, "+ 存入");
        var bLibDel   = libBtns.add("button", undefined, "− 刪除");

        function refreshLib() {
            libList.removeAll();
            for (var i = 0; i < libItems.length; i++) libList.add("item", libItems[i].name);
        }
        refreshLib();

        libList.onChange = function () {
            if (libList.selection) customBox.text = libItems[libList.selection.index].expr;
        };
        libList.onDoubleClick = function () {
            if (libList.selection)
                applyExprToSelection(libItems[libList.selection.index].expr, propDrop.selection.index, "套用常用表達式");
        };
        bLibApply.onClick = function () {
            if (!libList.selection) { alert("先在清單選一個表達式。"); return; }
            applyExprToSelection(libItems[libList.selection.index].expr, propDrop.selection.index, "套用常用表達式");
        };
        bLibAdd.onClick = function () {
            var txt = customBox.text;
            if (!txt || txt.replace(/\s/g, "") === "") { alert("先把表達式貼進上面的框,再按「存入」。"); return; }
            var nm = prompt("幫這個表達式取個名字:", "");
            if (!nm) return;
            libItems.push({ name: nm, expr: txt });
            libSave(libItems);
            refreshLib();
        };
        bLibDel.onClick = function () {
            if (!libList.selection) { alert("先在清單選一個要刪的。"); return; }
            libItems.splice(libList.selection.index, 1);
            libSave(libItems);
            refreshLib();
        };

        pal.layout.layout(true);
        updateScrollbars();
        var lastCols = colsPerRow();
        pal.onResizing = pal.onResize = function () {
            this.layout.resize();
            // 寬度改變導致每行按鈕數變了 → 重排命名按鈕
            try {
                var nowCols = colsPerRow();
                if (nowCols !== lastCols) { lastCols = nowCols; rebuildNames(); }
            } catch (e) {}
            updateScrollbars();
        };
        return pal;
    }

    var ui = buildUI(thisObj);
    if (ui instanceof Window) {
        ui.center(); ui.show();
        if (ui.__updateScroll) ui.__updateScroll();
    }

})(this);
