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
            }
        }
        if (!fx.property("face position")) {
            var p = fx.addProperty("ADBE Point Control");
            p.name = "face position";
            p.property(1).setValue([comp.width / 2, comp.height / 2]);
        }
        return ctrl;
    }

    function switchExpr(sliderName, val) {
        return 'sliderValue = thisComp.layer("control").effect("' + sliderName + '")("Slider")\n\n' +
               '// 設置透明度\nsliderValue == ' + val + '? 100 : 0\n';
    }

    function opacityProp(layer) {
        return layer.property("ADBE Transform Group").property("ADBE Opacity");
    }
    function scaleProp(layer) {
        return layer.property("ADBE Transform Group").property("ADBE Scale");
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

    // mouth 滑桿的「說話值」:有「張嘴 2」用 2,否則 1
    function talkValue(comp) {
        return findLayer(comp, "張嘴 2") ? 2 : 1;
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

    // 只有閉嘴圖的角色:自動生一張簡易張嘴(深色橢圓 Shape)
    function createOpenMouth(comp, closedLay) {
        var w = 60, h = 40;
        try { w = Math.max(closedLay.width * 0.8, 30); h = Math.max(closedLay.width * 0.55, 20); } catch (e) {}
        var shape = comp.layers.addShape();
        shape.name = "張嘴";
        var grp = shape.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        grp.name = "mouth";
        var ell = grp.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Ellipse");
        ell.property("ADBE Vector Ellipse Size").setValue([w, h]);
        var fill = grp.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill");
        fill.property("ADBE Vector Fill Color").setValue([0.23, 0.12, 0.10, 1]);
        shape.moveBefore(closedLay);
        if (closedLay.parent) shape.parent = closedLay.parent;
        shape.property("ADBE Transform Group").property("ADBE Position")
            .setValue(closedLay.property("ADBE Transform Group").property("ADBE Position").value);
        return shape;
    }

    // 只有張嘴圖的角色:在嘴軸中心生一條閉嘴線(#7E594C 圓角端點),
    // 長度參考張嘴圖寬,讓你自己調 Bezier 弧度。
    function createClosedMouth(comp, openLay) {
        var lineW = 60;
        try { lineW = Math.max(openLay.width * 0.75, 30); } catch (e) {}
        var half = lineW / 2;

        var shape = comp.layers.addShape();
        shape.name = "閉嘴";
        var vectors = shape.property("ADBE Root Vectors Group");
        var grp = vectors.addProperty("ADBE Vector Group");
        grp.name = "closed_mouth";
        var pathGrp = grp.property("ADBE Vectors Group");

        // 路徑:水平直線,兩端之後可自行拉成曲線
        var pathProp = pathGrp.addProperty("ADBE Vector Shape - Group");
        var myShape = new Shape();
        myShape.vertices    = [[-half, 0], [half, 0]];
        myShape.inTangents  = [[0, 0], [0, 0]];
        myShape.outTangents = [[0, 0], [0, 0]];
        myShape.closed = false;
        pathProp.property("ADBE Vector Shape").setValue(myShape);

        // Stroke:#7E594C,圓角端點,6px(可自行調粗細)
        var stroke = pathGrp.addProperty("ADBE Vector Graphic - Stroke");
        stroke.property("ADBE Vector Stroke Color").setValue([0.494, 0.349, 0.298, 1]);
        stroke.property("ADBE Vector Stroke Width").setValue(6);
        stroke.property("ADBE Vector Stroke Line Cap").setValue(2); // Round Cap

        var pos = openLay.property("ADBE Transform Group").property("ADBE Position").value;
        shape.property("ADBE Transform Group").property("ADBE Position").setValue(pos);
        if (openLay.parent) shape.parent = openLay.parent;
        shape.moveBefore(openLay);
        return shape;
    }

    // ================= 1. 標記 =================

    // 每個標記:基準名 / 滑桿 / 依序的滑桿值(第1個閉嘴=0、第2個=3…照你的慣例)
    var TAGS = {
        "閉眼": { slider: "eye",   vals: [1] },
        "睜眼": { slider: "eye",   vals: [0] },
        "閉嘴": { slider: "mouth", vals: [0, 3] },
        "張嘴": { slider: "mouth", vals: [1, 2] },
        "眉":   { slider: "眉",    vals: [0, 1, 2, 3] },
        "特效": { slider: "emo",   vals: [1, 2, 3, 4, 5] }, // 廣義表情特效:汗滴、怒氣、驚訝符號、愛心…都可掛在 emo 滑桿上
        "耳":   { slider: null },
        "鼻":   { slider: null }
    };

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

    function doTag(base, fullRig) {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先在時間軸選取要標記的圖層,再按「" + base + "」。"); return; }

        app.beginUndoGroup("標記 " + base);
        try {
            ensureControl(comp);
            var nulls = fullRig ? ensureRigNulls(comp) : null;
            var tag = TAGS[base];

            for (var i = 0; i < sel.length; i++) {
                var lay = sel[i];
                var idx = countByBase(comp, base); // 已有幾個同名 → 決定編號與滑桿值
                lay.name = (idx === 0) ? base : base + " " + (idx + 1);

                if (tag.slider) {
                    var v = tag.vals[Math.min(idx, tag.vals.length - 1)];
                    opacityProp(lay).expression = switchExpr(sliderNameFor(comp, tag.slider), v);
                }
                if (nulls && !lay.parent) {
                    if (base === "耳") lay.parent = nulls.ear;
                    else if (base === "鼻") lay.parent = nulls.face;
                    else if (tag.slider === "eye" || tag.slider === "眉") lay.parent = nulls.eye;
                    else if (tag.slider === "mouth") lay.parent = nulls.mouth;
                }
            }
        } finally { app.endUndoGroup(); }
    }

    // ---- 特殊表情(暈眼、X眼、哭嚎嘴…):掛到滑桿的下一個空值 ----

    function nextSliderValue(comp, sliderName) {
        // 標準慣例已占用的最大值
        var reserved = { eye: 1, mouth: 3, "眉": 3, emo: 5 };
        var maxV = (reserved[sliderName] !== undefined) ? reserved[sliderName] : 0;
        for (var i = 1; i <= comp.numLayers; i++) {
            try {
                var op = opacityProp(comp.layer(i));
                if (!op.expressionEnabled) continue;
                var ex = op.expression;
                if (ex.indexOf('effect("' + sliderName + '")') === -1) continue;
                // 注意:ExtendScript 不能寫 /==.../ 開頭的正則字面量,會被誤認成 /= 運算子
                var m = ex.match(new RegExp("==\\s*(\\d+)"));
                if (m && parseInt(m[1], 10) > maxV) maxV = parseInt(m[1], 10);
            } catch (e) {}
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
            alert("完成!演出時把 control > " + sliderName + " 滑桿切到 " + v +
                  " 就會顯示「" + base + "」。\n(滑桿 key 記得用 HOLD)");
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
            alert("完成!對應表:\n" + lines.join("\n") + "\n(依時間軸由上到下的順序編號)");
        } finally { app.endUndoGroup(); }
    }

    // ── 軸心聚焦:標記軸心時,只讓選中圖層 100% 顯示,其他降到 25% ──
    // 再按一次還原。只動「沒有掛表達式」的不透明度,避免跟滑桿切換打架。
    var _focusMemory = null;

    function doFocusToggle() {
        var comp = activeComp(); if (!comp) return;

        if (_focusMemory) {
            app.beginUndoGroup("還原軸心聚焦");
            try {
                for (var i = 0; i < _focusMemory.length; i++) {
                    try { opacityProp(_focusMemory[i].layer).setValue(_focusMemory[i].value); } catch (e) {}
                }
            } finally { app.endUndoGroup(); }
            _focusMemory = null;
            showStatus("已還原圖層不透明度。");
            return;
        }

        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取要設定軸心的圖層,再按「軸心聚焦」。"); return; }

        app.beginUndoGroup("軸心聚焦");
        try {
            _focusMemory = [];
            for (var i = 1; i <= comp.numLayers; i++) {
                var lay = comp.layer(i);
                var op;
                try { op = opacityProp(lay); } catch (e) { continue; }
                if (op.expressionEnabled) continue; // 交給滑桿控制的不透明度不動
                _focusMemory.push({ layer: lay, value: op.value });
                var isSel = false;
                for (var s = 0; s < sel.length; s++) if (sel[s] === lay) { isSel = true; break; }
                op.setValue(isSel ? 100 : 25);
            }
        } finally { app.endUndoGroup(); }
        showStatus("已聚焦選取圖層,其他降到 25%。設定完軸心後再按一次「軸心聚焦」還原。");
    }

    // ================= 2. 一鍵動態 =================

    function doBlink() {
        var comp = activeComp(); if (!comp) return;
        app.beginUndoGroup("隨機眨眼");
        try {
            var closed = findLayer(comp, "閉眼");
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
                alert("已在 control > " + eyeName + " 滑桿掛上隨機眨眼。\n\n" +
                      "control 上多了「眨眼」勾選框:\n" +
                      "  ✔ 勾選 = 自動隨機眨(你打的手動 key 也同時有效,兩者取最大值)\n" +
                      "  ✗ 取消 = 純手動模式\n\n" +
                      "【取消勾選時如何演閉眼?】\n" +
                      "直接在 eye 滑桿上打 HOLD key → 值設 1 = 閉眼、值設 0 = 睜眼。\n" +
                      "不需要另外新增圖層,「閉眼」圖層已自動在 eye=1 時顯示。");
            } else {
                // 備援方案:沒有閉眼圖層 → 對「睜眼/眼」做縮放擠壓眨眼(透過眼軸,斜眼不會歪)
                var eyeLay = findLayer(comp, "睜眼") || findLayer(comp, "眼") ||
                             (comp.selectedLayers.length ? comp.selectedLayers[0] : null);
                if (!eyeLay) { alert("找不到「閉眼」「睜眼」「眼」圖層。\n請先標記,或選取眼睛圖層後再按一次。"); return; }
                var axis = makeAxisNull(comp, eyeLay, "眼軸");
                var lines2 = ["// === 隨機眨眼:縮放擠壓版(此角色沒有閉眼圖) ==="]
                    .concat(blinkWindowLines(uniqueSeed(), 2.5, 6, 7))
                    .concat(["blink ? [value[0], value[1] * 0.08] : value"]);
                scaleProp(axis).expression = lines2.join("\n");
                alert("此角色沒有「閉眼」圖 → 已建「眼軸」Null 套擠壓眨眼(作用在「" + eyeLay.name + "」上)。\n\n" +
                      "眼睛如果是斜的:把「眼軸」的 Rotation 轉到跟眼睛同角度即可,\n" +
                      "美術不會跟著轉,擠壓會沿眼睛的方向、不會歪。");
            }
        } finally { app.endUndoGroup(); }
    }

    function doTalkSetup() {
        var comp = activeComp(); if (!comp) return;
        app.beginUndoGroup("說話設定");
        try {
            var ctrl = ensureControl(comp);
            var mouthName = sliderNameFor(comp, "mouth"); // 自動沿用 mouth 或 嘴
            var open2 = findLayer(comp, "張嘴 2"), open1 = findLayer(comp, "張嘴"),
                closed = findLayer(comp, "閉嘴");

            // 「靜嘴」勾選框:勾選時即使 mouth 滑桿在說話值,嘴巴也不會開合擠壓
            // (給「靜止張嘴」用——嘴張開但不動)
            var fx = ctrl.property("ADBE Effect Parade");
            var cbStill = fx.property("靜嘴");
            if (!cbStill) {
                cbStill = fx.addProperty("ADBE Checkbox Control");
                cbStill.name = "靜嘴";
                cbStill.property(1).setValue(0);
            }

            function squashExpr(activeVal) {
                return [
                    "// === 說話擠壓(" + mouthName + " 滑桿 == " + activeVal + " 時啟動) ===",
                    's = thisComp.layer("control").effect("' + mouthName + '")("Slider");',
                    "var still = false;",
                    'try { still = thisComp.layer("control").effect("靜嘴")("Checkbox") == 1; } catch (e) {}',
                    "var speed = 9, amp = 45; // 開合速度 / 幅度(%)",
                    "if (s == " + activeVal + " && !still) {",
                    "  var k = 1 - (amp / 100) * Math.abs(Math.sin(time * speed));",
                    "  // 相容 2D Null(嘴軸)與 3D 圖層",
                    "  value.length > 2 ? [value[0], value[1] * k, value[2]] : [value[0], value[1] * k];",
                    "} else { value; }"
                ].join("\n");
            }

            var target = open2 || open1;
            var v, generated = false;

            if (!target && closed) {
                // 只有閉嘴圖:自動生一張簡易張嘴,之後走標準閉/張切換
                target = createOpenMouth(comp, closed);
                opacityProp(target).expression = switchExpr(mouthName, 1);
                opacityProp(closed).expression = switchExpr(mouthName, 0);
                v = 1;
                generated = true;
            } else if (target && !closed) {
                // 只有張嘴圖:自動生一條閉嘴線(#7E594C 圓角),走標準閉/張切換
                closed = createClosedMouth(comp, target);
                opacityProp(closed).expression = switchExpr(mouthName, 0);
                opacityProp(target).expression = switchExpr(mouthName, open2 ? 2 : 1);
                v = open2 ? 2 : 1;
                generated = "open_only";
            } else if (target) {
                v = open2 ? 2 : 1;
            } else {
                alert("找不到「張嘴」或「閉嘴」圖層,請先在「標記」頁標記嘴巴圖層。");
                return;
            }

            // 擠壓掛在「嘴軸」Null 上,斜的嘴不會歪
            var axis = makeAxisNull(comp, target, "嘴軸");
            scaleProp(axis).expression = squashExpr(v);

            var msg = "說話設定完成:" + mouthName + " 滑桿 = " + v + " 時「" + target.name + "」會自動開合,= 0 是閉嘴。\n" +
                      "用下面的「開始/停止說話」按鈕打 key 即可。\n\n" +
                      "嘴如果是斜的:把「嘴軸」的 Rotation 轉到跟嘴同角度,\n" +
                      "美術不會跟著轉,開合就會沿嘴的方向、不會歪。\n\n" +
                      "【靜止張嘴】control 上多了「靜嘴」勾選框:\n" +
                      "勾選後,即使 " + mouthName + " 在說話值,嘴巴也只張開不開合,\n" +
                      "適合角色靜止張嘴(如唱歌長音)的演出。";
            if (generated === true) {
                msg += "\n\n此角色原本只有閉嘴圖,我生了一個深色橢圓 Shape 當「張嘴」,\n" +
                       "請花十秒調一下它的大小和顏色,讓它貼合畫風。";
            } else if (generated === "open_only") {
                msg += "\n\n此角色只有張嘴圖,我已自動生成一條「閉嘴」線段(#7E594C 圓角)。\n" +
                       "位置在嘴軸中心,你可以:\n" +
                       "  1. 選取「閉嘴」圖層 → 用鋼筆工具拉 Bezier 弧度調成你要的曲線\n" +
                       "  2. 調整 Stroke 寬度/顏色讓它配合角色畫風\n" +
                       "滑桿 = 0 → 顯示閉嘴線 / 滑桿 = " + v + " → 顯示張嘴圖,正常切換。";
            }
            alert(msg);
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

    function doSway() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取圖層再按「擺動」。"); return; }
        app.beginUndoGroup("擺動");
        try {
            for (var i = 0; i < sel.length; i++) {
                sel[i].property("ADBE Transform Group").property("ADBE Rotate Z").expression = [
                    "// === 微微擺動(面板自動加入) ===",
                    "var amp = 3, period = 2.8; // 幅度(度) / 週期(秒)",
                    "seedRandom(index, true);",
                    "var ph = random(0, period); // 每個圖層相位錯開",
                    "value + amp * Math.sin((time + ph) * 2 * Math.PI / period)"
                ].join("\n");
            }
        } finally { app.endUndoGroup(); }
        showStatus("已套擺動到 " + sel.length + " 個圖層(Rotation ±3°)。建議先建控制NULL再套,避免跟其他旋轉表達式衝突。");
    }

    // ================= 3. 演出:說話 key =================

    function setMouthKey(talking) {
        var comp = activeComp(); if (!comp) return;
        app.beginUndoGroup(talking ? "開始說話" : "停止說話");
        try {
            var ctrl = ensureControl(comp);
            var mouthName = sliderNameFor(comp, "mouth"); // 自動沿用 mouth 或 嘴
            var slider = ctrl.property("ADBE Effect Parade").property(mouthName).property(1);
            var v = talking ? talkValue(comp) : 0;
            slider.setValueAtTime(comp.time, v);
            // 滑桿切換一定要 HOLD,不然中間值會讓所有嘴都消失
            var k = slider.nearestKeyIndex(comp.time);
            slider.setInterpolationTypeAtKey(k,
                KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
        } finally { app.endUndoGroup(); }
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
        if (fail.length) msg += "\n套不上的:" + fail.join("、") + "(表達式跟屬性維度可能不合)";
        alert(msg);
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
        { zh:"腰帶",  en:"belt",      cat:"身體" },
        { zh:"屁股",  en:"hip",       cat:"身體" },

        { zh:"手臂左", en:"arm_L",     cat:"手臂" },
        { zh:"上臂左", en:"arm_up_L",  cat:"手臂" },
        { zh:"下臂左", en:"arm_low_L", cat:"手臂" },
        { zh:"手左",  en:"hand_L",    cat:"手臂" },
        { zh:"手臂右", en:"arm_R",     cat:"手臂" },
        { zh:"上臂右", en:"arm_up_R",  cat:"手臂" },
        { zh:"下臂右", en:"arm_low_R", cat:"手臂" },
        { zh:"手右",  en:"hand_R",    cat:"手臂" },

        { zh:"腿左",  en:"leg_L",     cat:"腿腳" },
        { zh:"大腿左", en:"leg_up_L",  cat:"腿腳" },
        { zh:"小腿左", en:"leg_low_L", cat:"腿腳" },
        { zh:"腳左",  en:"foot_L",    cat:"腿腳" },
        { zh:"腿右",  en:"leg_R",     cat:"腿腳" },
        { zh:"大腿右", en:"leg_up_R",  cat:"腿腳" },
        { zh:"小腿右", en:"leg_low_R", cat:"腿腳" },
        { zh:"腳右",  en:"foot_R",    cat:"腿腳" },

        { zh:"頭髮",  en:"hair",      cat:"配件" },
        { zh:"帽子",  en:"hat",       cat:"配件" },
        { zh:"包包",  en:"bag",       cat:"配件" },
        { zh:"尾巴",  en:"tail",      cat:"配件" },
        { zh:"陰影",  en:"shadow",    cat:"配件" },
        { zh:"光",    en:"light",     cat:"配件" }
    ];

    // 反向語序別名（左手/右手/左腿/右腿…）：只用於中英轉換比對，不出現在命名按鈕上
    var NAME_ALIASES = [
        { zh:"左手臂", en:"arm_L" },
        { zh:"右手臂", en:"arm_R" },
        { zh:"左上臂", en:"arm_up_L" },
        { zh:"右上臂", en:"arm_up_R" },
        { zh:"左下臂", en:"arm_low_L" },
        { zh:"右下臂", en:"arm_low_R" },
        { zh:"左手",  en:"hand_L" },
        { zh:"右手",  en:"hand_R" },
        { zh:"左腿",  en:"leg_L" },
        { zh:"右腿",  en:"leg_R" },
        { zh:"左大腿", en:"leg_up_L" },
        { zh:"右大腿", en:"leg_up_R" },
        { zh:"左小腿", en:"leg_low_L" },
        { zh:"右小腿", en:"leg_low_R" },
        { zh:"左腳",  en:"foot_L" },
        { zh:"右腳",  en:"foot_R" }
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
                    // 帶數字後綴：「頭1」→「head1」
                    if (nm.indexOf(src) === 0) {
                        var tail = nm.substring(src.length);
                        if (/^\d+$/.test(tail)) {
                            lay.name = dst + tail; count++; break;
                        }
                    }
                }
            }
        } finally { app.endUndoGroup(); }
        alert("轉換完成，更名了 " + count + " 個圖層。\n對照表以外的圖層不會動。");
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
                        if (/^\d+$/.test(tail)) { sel[s].name = dst + tail; count++; break; }
                    }
                }
            }
        } finally { app.endUndoGroup(); }
        if (count === 0) alert("選取的圖層名稱都不在對照表裡。");
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
        alert(sel.length + " 個圖層已綁到「" + nm + "」之下,劇情動作打在它身上。");
    }

    // ── 縮小 comp 到有圖層內容的最小範圍 ──────────────────────
    // 掃所有非 Null 圖層的 sourceRectAtTime,計算最小外框後 resize comp
    function doTrimToContent() {
        var comp = activeComp(); if (!comp) return;
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        var found = false;
        var t = comp.time;
        app.beginUndoGroup("縮小 comp 到有圖範圍");
        try {
            for (var i = 1; i <= comp.numLayers; i++) {
                var lay = comp.layer(i);
                if (lay.nullLayer || lay.adjustmentLayer) continue;
                try {
                    var r = lay.sourceRectAtTime(t, false);
                    var corners = [
                        [r.left,           r.top],
                        [r.left + r.width, r.top],
                        [r.left,           r.top + r.height],
                        [r.left + r.width, r.top + r.height]
                    ];
                    for (var c = 0; c < corners.length; c++) {
                        var pt = lay.toComp(corners[c]);
                        if (pt[0] < minX) minX = pt[0];
                        if (pt[1] < minY) minY = pt[1];
                        if (pt[0] > maxX) maxX = pt[0];
                        if (pt[1] > maxY) maxY = pt[1];
                    }
                    found = true;
                } catch (e) {}
            }
            if (!found) { alert("找不到有可見內容的圖層。"); app.endUndoGroup(); return; }

            var pad = 4;
            minX = Math.floor(minX - pad); minY = Math.floor(minY - pad);
            maxX = Math.ceil(maxX + pad);  maxY = Math.ceil(maxY + pad);
            var newW = maxX - minX, newH = maxY - minY;
            if (newW < 1 || newH < 1) { alert("計算結果異常,請確認圖層有可見內容。"); app.endUndoGroup(); return; }

            for (var j = 1; j <= comp.numLayers; j++) {
                var L = comp.layer(j);
                try {
                    var pos = L.property("ADBE Transform Group").property("ADBE Position");
                    if (!pos.expressionEnabled) {
                        var pv = pos.value;
                        pos.setValue([pv[0] - minX, pv[1] - minY]);
                    }
                } catch (e) {}
            }
            comp.width  = newW;
            comp.height = newH;
            alert("完成!comp 已縮為 " + newW + " × " + newH + " px。\n" +
                  "各圖層位置已同步平移,外觀不會跑掉。\n" +
                  "現在可用「圖層 → Transform → Center Anchor Point in Layer Content」把錨點置中。");
        } finally { app.endUndoGroup(); }
    }

    // ── 手動裁切流程（用 AE 內建的 Region of Interest）──────
    // ROI 是合成視窗上可以拖曳的框，但「拖框」這動作 ScriptUI 無法代勞，
    // 所以拆成兩步：① 幫你 solo 圖層並提示開 ROI；② 你拉好框後一鍵裁切。
    var _soloMemory = null; // 記住裁切前哪些圖層原本是 solo

    function doSoloAndROI() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取要單獨顯示、裁切的圖層。"); return; }
        app.beginUndoGroup("solo 圖層準備裁切");
        try {
            // 記住原本的 solo 狀態，待會還原
            _soloMemory = [];
            for (var i = 1; i <= comp.numLayers; i++) {
                _soloMemory.push(comp.layer(i).solo);
            }
            // 把選取圖層設 solo，其餘取消
            for (var j = 1; j <= comp.numLayers; j++) comp.layer(j).solo = false;
            for (var k = 0; k < sel.length; k++) sel[k].solo = true;
        } finally { app.endUndoGroup(); }
        alert("已 solo 選取圖層。\n\n接下來請手動操作:\n" +
              "1. 在合成視窗底部點「感興趣區域」按鈕\n" +
              "   (Region of Interest,虛線方框圖示)\n" +
              "2. 在畫面上拖出你要保留的範圍\n" +
              "3. 回來按「② 裁切到框 + 還原 solo」\n\n" +
              "(ROI 的拖曳框 AE 腳本無法代勞,這步要你手動拉)");
    }

    function doCropToROI() {
        var comp = activeComp(); if (!comp) return;
        app.beginUndoGroup("裁切到 ROI");
        try {
            // 觸發 AE 內建:Crop Comp to Region of Interest
            // 固定 menu command ID 2997 跨語言/版本穩定;名稱查找在中文版會失敗,故先用 ID。
            var ok = false;
            try { app.executeCommand(2997); ok = true; } catch (e1) {}
            if (!ok) {
                // 後援:用名稱查找(英文版才有效)
                try { app.executeCommand(app.findMenuCommandId("Crop Comp to Region of Interest")); ok = true; } catch (e2) {}
            }
            if (!ok) {
                alert("無法自動裁切。\n請手動執行:\n" +
                      "  合成(Composition) 選單 → 裁切合成至感興趣區域\n" +
                      "  (Crop Comp to Region of Interest)\n\n" +
                      "(裁切後 solo 狀態仍會由本面板還原)");
            }
            // 還原 solo 狀態(裁切後圖層數不變,可安全對應)
            if (_soloMemory && _soloMemory.length === comp.numLayers) {
                for (var i = 1; i <= comp.numLayers; i++) {
                    comp.layer(i).solo = _soloMemory[i - 1];
                }
            }
            _soloMemory = null;
        } finally { app.endUndoGroup(); }
        alert("裁切完成,solo 已還原。\n" +
              "如果畫面沒裁切,表示沒先拉 ROI 框 —— 請重按①重新來。");
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
        alert(count === 0 ? "選取的圖層上找不到「key + loopOut」的循環屬性。"
                          : "已重排 " + count + " 個循環屬性,一趟 = " + frames + " 格。");
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
        alert(count === 0 ? "選取的圖層上找不到可調速的表達式(speed / period / wiggle)。"
                          : "已調整 " + count + " 個表達式,倍速 ×" + m + "。");
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
                { child: "leg_low_R", parent: "leg_up_R" },
                // 後援：手臂/腿沒有分上下段(只有一段)時,直接掛身體/全身NULL
                // 必須放在分段規則之後 ── 已綁過的會因為已有 parent 而跳過
                { child: "arm_L", parent: "body" },
                { child: "arm_R", parent: "body" },
                { child: "leg_L", parent: BODY_NULL_NAME },
                { child: "leg_R", parent: BODY_NULL_NAME }
            ]
        }
    };

    // 使用者自訂「骨架別名」：把圖層名稱前綴對應到骨架規則的 key(如 arm_L)。
    // 解決命名跟規則對不上的問題(例如圖層叫「左手臂」而規則找的是 arm_L)。
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

    // 收集符合骨架 key 的圖層:內建前綴比對 + 使用者自訂別名
    function findLayersByBoneKey(comp, key) {
        var result = findLayersByPrefix(comp, key);
        var aliases = boneAliasLoad();
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
        if (linked === 0 && skipped.length === 0) msg = "找不到符合「" + presetKey + "」命名規則的圖層。\n請確認圖層命名是否符合規則(用命名頁轉成英文)。";
        alert(msg);
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
        var p1 = makeTab("標記");
        p1.add("statictext", undefined, "先選圖層再按按鈕:  [v2.0]");
        var rowA = p1.add("group"); var rowB = p1.add("group");
        var tagOrder = ["閉眼", "睜眼", "閉嘴", "張嘴", "眉", "特效", "耳", "鼻"];
        var fullRigCheck;
        for (var i = 0; i < tagOrder.length; i++) {
            var row = (i < 4) ? rowA : rowB;
            (function (base) {
                var b = row.add("button", undefined, base);
                b.preferredSize.width = 52;
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

        var rowFocus = p1.add("group");
        var bFocus = rowFocus.add("button", undefined, "軸心聚焦(選中100%,其他25%)");
        bFocus.preferredSize.width = 200;
        bFocus.onClick = doFocusToggle;
        rowFocus.add("statictext", undefined, "← 設軸心前按,選好下一個再按一次,完成後再按一次還原");

        // --- 命名 / 控制 NULL ---
        var p5 = makeTab("命名");

        // ── 顯示模式 ──────────────────────────────────────────
        var rowMode = p5.add("group");
        rowMode.add("statictext", undefined, "按鈕顯示:");
        var radShowZh = rowMode.add("radiobutton", undefined, "中文");
        var radShowEn = rowMode.add("radiobutton", undefined, "英文");
        radShowZh.value = true;
        function showEn() { return radShowEn.value; }

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

        function rebuildNames() {
            while (nameGrid.children.length > 0) nameGrid.remove(nameGrid.children[0]);
            var allItems = fullMap();
            var cats = getCategories(allItems);
            for (var c = 0; c < cats.length; c++) {
                var cat = cats[c];
                var catItems = [];
                for (var k = 0; k < allItems.length; k++) {
                    if ((allItems[k].cat || "其他") === cat) catItems.push(allItems[k]);
                }
                addCategoryRow(cat, catItems);
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

        // ── 中英轉換（一列：範圍開關 + 兩顆按鈕）─────────────
        var rowConv = p5.add("group");
        rowConv.add("statictext", undefined, "轉換:");
        var radScopeSel = rowConv.add("radiobutton", undefined, "選取");
        var radScopeAll = rowConv.add("radiobutton", undefined, "全comp");
        radScopeSel.value = true;
        function convScope(dir) {
            if (radScopeAll.value) doConvertAll(dir);
            else                   doConvertSelected(dir);
        }
        var bToEn = rowConv.add("button", undefined, "轉英文"); bToEn.preferredSize.width = 70;
        var bToZh = rowConv.add("button", undefined, "轉中文"); bToZh.preferredSize.width = 70;
        bToEn.onClick = function () { convScope("toEn"); };
        bToZh.onClick = function () { convScope("toZh"); };

        // ── Comp 裁切（標籤 + 兩步驟按鈕同列）──────────────────
        var rowCrop = p5.add("group");
        var labCrop = rowCrop.add("statictext", undefined, "裁切:"); labCrop.preferredSize.width = 70;
        var bSoloRoi = rowCrop.add("button", undefined, "①solo+框"); bSoloRoi.preferredSize.width = 90;
        var bDoCrop  = rowCrop.add("button", undefined, "②裁切還原"); bDoCrop.preferredSize.width = 90;
        bSoloRoi.onClick = doSoloAndROI;
        bDoCrop.onClick  = doCropToROI;
        var rowCrop2 = p5.add("group");
        var labCrop2 = rowCrop2.add("statictext", undefined, ""); labCrop2.preferredSize.width = 70;
        var bTrim = rowCrop2.add("button", undefined, "或：自動縮到有圖範圍"); bTrim.preferredSize.width = 180;
        bTrim.onClick = doTrimToContent;

        // ====== 綁定分頁（控制 NULL / 骨架 / 錨點）======
        var p6 = makeTab("綁定");

        // ── 建立角色 control（含常用滑桿）──────────────────────
        var rowCtl = p6.add("group");
        var labCtl = rowCtl.add("statictext", undefined, "Control:"); labCtl.preferredSize.width = 70;
        var bCtl = rowCtl.add("button", undefined, "建 control(含常用滑桿)");
        bCtl.preferredSize.width = 160;
        bCtl.onClick = function () {
            var comp = activeComp(); if (!comp) return;
            app.beginUndoGroup("建 control");
            try { ensureControl(comp); } finally { app.endUndoGroup(); }
            alert("control 已就緒:eye / mouth / 眉 / emo 滑桿 + face position 點控制。\n" +
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
                  "  單段手臂(arm_L/arm_R) → 身體(沒分上下臂時)\n" +
                  "  單段腿(leg_L/leg_R)   → 全身NULL(沒分大小腿時)\n" +
                  "  頭(head)     → 身體\n\n" +
                  "沒有屁股圖層時,身體會直接掛全身NULL。\n" +
                  "先在命名頁把名稱轉成英文,再按此按鈕效果最佳。\n" +
                  "已有 parent 的圖層不會被覆蓋。\n\n" +
                  "圖層名稱跟規則對不上?用下面的「綁定別名」\n" +
                  "告訴面板你的某個前綴對應到哪個規則 key。");
        };

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
                "arm_up_L / arm_up_R / arm_low_L / arm_low_R / arm_L / arm_R /\n" +
                "leg_up_L / leg_up_R / leg_low_L / leg_low_R / leg_L / leg_R",
                "arm_L");
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
        var p2 = makeTab("動態(自動)");
        p2.add("statictext", undefined, "套用後自動循環播放,不用打 key(眨眼/說話開合/呼吸/漂浮/擺動):");
        var rowC = p2.add("group"); var rowD = p2.add("group");
        var bBlink = rowC.add("button", undefined, "隨機眨眼");   bBlink.preferredSize.width = 110;
        var bTalk  = rowC.add("button", undefined, "說話設定");   bTalk.preferredSize.width = 110;
        var bBr    = rowD.add("button", undefined, "呼吸(選取)"); bBr.preferredSize.width = 110;
        var bFl    = rowD.add("button", undefined, "漂浮(選取)"); bFl.preferredSize.width = 110;
        var bSway  = rowD.add("button", undefined, "擺動(選取)"); bSway.preferredSize.width = 110;
        bBlink.onClick = doBlink;
        bTalk.onClick  = doTalkSetup;
        bBr.onClick    = doBreath;
        bFl.onClick    = doFloat;
        bSway.onClick  = doSway;

        p2.add("statictext", undefined, "節奏(用數字調,不用憑感覺拉 key):");
        var rowRt = p2.add("group");
        var bLoopT = rowRt.add("button", undefined, "循環 key 節奏…"); bLoopT.preferredSize.width = 110;
        var bExprT = rowRt.add("button", undefined, "表達式倍速…");   bExprT.preferredSize.width = 110;
        bLoopT.onClick = retimeLoopKeys;
        bExprT.onClick = retimeExprSpeed;

        // --- 演出(手動下 key:人待在主場景,key 寫進角色的 control) ---
        var p3 = makeTab("演出(手動Key)");

        var rigComps = [];
        var rowChar = p3.add("group");
        rowChar.add("statictext", undefined, "角色:");
        var charDrop = rowChar.add("dropdownlist", undefined, []);
        charDrop.preferredSize.width = 150;
        var bScan = rowChar.add("button", undefined, "↻"); bScan.preferredSize.width = 30;

        function refreshRigComps() {
            rigComps = [];
            charDrop.removeAll();
            try {
                for (var i = 1; i <= app.project.numItems; i++) {
                    var it = app.project.item(i);
                    if (it instanceof CompItem && findLayer(it, "control")) {
                        rigComps.push(it);
                        var folder = (it.parentFolder && it.parentFolder.name !== "Root")
                                   ? "  [" + it.parentFolder.name + "]" : "";
                        charDrop.add("item", it.name + folder);
                    }
                }
            } catch (e) {}
            if (charDrop.items.length > 0) charDrop.selection = 0;
        }
        refreshRigComps();
        bScan.onClick = refreshRigComps;

        // ── 鎖定角色:可直接鎖「目前選取的角色圖層」(在外層合成裡的頭/角色 precomp),
        // 之後下 key 會自動換算成該角色內部的時間,不用切進頭合成。
        // 若該角色合成本身就有 control(沒有額外的頭/角色 comp),也可直接鎖目前合成。
        var lockedTarget = null; // { comp, layer } ; layer 為 null 表示直接鎖目前合成本身
        var rowLock = p3.add("group");
        var bLock = rowLock.add("button", undefined, "鎖定選取角色圖層"); bLock.preferredSize.width = 140;
        var bUnlock = rowLock.add("button", undefined, "解除鎖定"); bUnlock.preferredSize.width = 80;
        var lockLabel = rowLock.add("statictext", undefined, "(未鎖定,使用上面下拉選的角色)");
        lockLabel.preferredSize.width = 260;
        bLock.onClick = function () {
            var c = app.project.activeItem;
            if (!(c instanceof CompItem)) { alert("先點開外層合成,選取角色圖層再按此按鈕。"); return; }
            var sel = c.selectedLayers;
            if (sel.length > 0 && sel[0].source instanceof CompItem && findLayer(sel[0].source, "control")) {
                lockedTarget = { comp: sel[0].source, layer: sel[0] };
                lockLabel.text = "已鎖定:「" + sel[0].name + "」(內部合成:" + sel[0].source.name + ")";
                return;
            }
            if (findLayer(c, "control")) {
                lockedTarget = { comp: c, layer: null };
                lockLabel.text = "已鎖定:目前合成「" + c.name + "」本身(無頭層結構)";
                return;
            }
            alert("找不到可鎖定的角色。\n" +
                  "請選取一個「來源合成內含 control」的角色圖層,\n" +
                  "或直接打開角色本身就有 control 的合成(無頭層結構)。");
        };
        bUnlock.onClick = function () {
            lockedTarget = null;
            lockLabel.text = "(未鎖定,使用上面下拉選的角色)";
        };

        function targetComp() {
            if (lockedTarget) return lockedTarget.comp;
            if (!charDrop.selection) { alert("先按 ↻ 掃描專案,再從下拉選角色(有 control 的合成),\n或用「鎖定選取角色圖層」。"); return null; }
            return rigComps[charDrop.selection.index];
        }

        // 用「目前開著的合成」的時間下 key(你們所有合成都是同一條全片時間軸)
        // 若鎖定的是外層合成裡的角色層,換算成該角色內部合成的時間。
        function nowTime(tc) {
            if (lockedTarget && lockedTarget.layer) {
                var layer = lockedTarget.layer;
                var outer = layer.containingComp;
                return (outer.time - layer.startTime) * 100 / layer.stretch;
            }
            var a = app.project.activeItem;
            return (a instanceof CompItem) ? a.time : tc.time;
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
                slider.setValueAtTime(t, val);
                var k = slider.nearestKeyIndex(t);
                slider.setInterpolationTypeAtKey(k,
                    KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
            } finally { app.endUndoGroup(); }
        }

        p3.add("statictext", undefined, "停在目前時間,點按鈕(不用進頭合成):");
        var rowT = p3.add("group");
        var bOn  = rowT.add("button", undefined, "▶ 開始說話"); bOn.preferredSize.width = 110;
        var bOff = rowT.add("button", undefined, "■ 停止說話"); bOff.preferredSize.width = 110;
        bOn.onClick  = function () { var tc = targetComp(); if (!tc) return; remoteKey("mouth", talkValue(tc)); };
        bOff.onClick = function () { remoteKey("mouth", 0); };

        // 掃這個角色的 control,列出某滑桿目前每個數值各對應哪個圖層(表情/狀態)
        function describeSliderValues(comp, sliderName) {
            var map = {};
            for (var i = 1; i <= comp.numLayers; i++) {
                try {
                    var op = opacityProp(comp.layer(i));
                    if (!op.expressionEnabled) continue;
                    var ex = op.expression;
                    if (ex.indexOf('effect("' + sliderName + '")') === -1) continue;
                    var m = ex.match(new RegExp("==\\s*(\\d+)"));
                    if (!m) continue;
                    if (!map[m[1]]) map[m[1]] = [];
                    map[m[1]].push(comp.layer(i).name);
                } catch (e) {}
            }
            var keys = [];
            for (var k in map) if (map.hasOwnProperty(k)) keys.push(k);
            keys.sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); });
            var lines = [];
            for (var j = 0; j < keys.length; j++) lines.push(keys[j] + " → " + map[keys[j]].join("、"));
            return lines;
        }

        p3.add("statictext", undefined, "通用滑桿:選角色 + 滑桿 + 值,按「下 HOLD key」在目前時間切換表情/狀態。");
        var rowX = p3.add("group");
        rowX.add("statictext", undefined, "滑桿:");
        var SLD_ROLES = ["eye", "mouth", "眉", "emo"];
        var sldDrop = rowX.add("dropdownlist", undefined, ["眼 eye", "嘴 mouth", "眉", "emo"]);
        sldDrop.selection = 0;
        rowX.add("statictext", undefined, "值:");
        var valBox = rowX.add("edittext", undefined, "1");
        valBox.preferredSize.width = 36;
        var bKey = rowX.add("button", undefined, "下 HOLD key");
        bKey.onClick = function () {
            var v = parseFloat(valBox.text);
            if (isNaN(v)) { alert("值要是數字。"); return; }
            remoteKey(SLD_ROLES[sldDrop.selection.index], v);
        };
        var bSldInfo = rowX.add("button", undefined, "查表"); bSldInfo.preferredSize.width = 50;
        bSldInfo.onClick = function () {
            var tc = targetComp(); if (!tc) return;
            var role = SLD_ROLES[sldDrop.selection.index];
            var sliderName = sliderNameFor(tc, role);
            var lines = describeSliderValues(tc, sliderName);
            alert(lines.length === 0
                ? "「" + sliderName + "」滑桿目前沒有任何圖層的不透明度跟它連動。"
                : "「" + sliderName + "」滑桿的值對應(填到上面「值」欄):\n" + lines.join("\n"));
        };

        // ── 演出快捷鍵(需先「鎖定選取角色圖層」)──────────────
        p3.add("statictext", undefined, "演出快捷鍵(嚇一跳/翻轉/閃爍,要先鎖定角色圖層):");
        var rowShort = p3.add("group");
        var bShock = rowShort.add("button", undefined, "嚇一跳"); bShock.preferredSize.width = 70;
        var bFlip  = rowShort.add("button", undefined, "左右翻轉"); bFlip.preferredSize.width = 70;
        var bFlash = rowShort.add("button", undefined, "閃爍"); bFlash.preferredSize.width = 70;

        function needLockedLayer() {
            if (lockedTarget && lockedTarget.layer) return lockedTarget.layer;
            alert("這個快捷鍵需要先在外層合成選取角色圖層,\n再按上面的「鎖定選取角色圖層」。");
            return null;
        }

        bShock.onClick = function () {
            var layer = needLockedLayer(); if (!layer) return;
            app.beginUndoGroup("演出:嚇一跳");
            try {
                var scale = layer.property("ADBE Transform Group").property("ADBE Scale");
                var outer = layer.containingComp;
                var t = outer.time;
                var base = scale.valueAtTime(t, false);
                var big = [base[0] * 1.2, base[1] * 1.2];
                scale.setValueAtTime(t, base);
                scale.setValueAtTime(t + 0.08, big);
                scale.setValueAtTime(t + 0.20, base);
            } finally { app.endUndoGroup(); }
            showStatus("已加入「嚇一跳」縮放動畫(目前時間附近)。");
        };

        bFlip.onClick = function () {
            var layer = needLockedLayer(); if (!layer) return;
            app.beginUndoGroup("演出:左右翻轉");
            try {
                var scale = layer.property("ADBE Transform Group").property("ADBE Scale");
                var outer = layer.containingComp;
                var t = outer.time;
                var base = scale.valueAtTime(t, false);
                var flipped = [-base[0], base[1]];
                if (base.length > 2) flipped.push(base[2]);
                scale.setValueAtTime(t, flipped);
                var k = scale.nearestKeyIndex(t);
                scale.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
            } finally { app.endUndoGroup(); }
            showStatus("已在目前時間下「左右翻轉」HOLD key(Scale X 正負互換)。");
        };

        bFlash.onClick = function () {
            var layer = needLockedLayer(); if (!layer) return;
            app.beginUndoGroup("演出:閃爍");
            try {
                var op = layer.property("ADBE Transform Group").property("ADBE Opacity");
                var outer = layer.containingComp;
                var t = outer.time;
                var base = op.valueAtTime(t, false);
                var seq = [base, 20, base, 20, base];
                for (var i = 0; i < seq.length; i++) {
                    var kt = t + i * 0.06;
                    op.setValueAtTime(kt, seq[i]);
                    var k = op.nearestKeyIndex(kt);
                    op.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
                }
            } finally { app.endUndoGroup(); }
            showStatus("已加入「閃爍」不透明度 HOLD key 序列(目前時間附近)。");
        };

        // --- 表達式工具 ---
        var p4 = makeTab("表達式");

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
