// ShotPanel.jsx — 繪本分鏡 / 運鏡 / 預覽效能面板 v1.0
//
// 安裝(建議,變成常駐面板):
//   把這個檔案放到 AE 安裝目錄的 Support Files\Scripts\ScriptUI Panels\
//   重開 AE 後,在 Window 選單最下面會出現「分鏡工具」
// 或臨時使用:File > Scripts > Run Script File...(會開成浮動視窗)
//
// 適用工法:一集少量大插圖、照音檔做長動畫。每一鏡 = 一整疊圖層 parent 到一顆
// 「鏡頭層(BG/Null)」,運鏡(推拉搖)的 Position/Scale key 打在鏡頭層上。
//
//   運鏡   選鏡頭層 → 開頭設起幀 → 結尾設迄幀(自動補 Position+Scale + 緩動)
//   切鏡   選整疊圖層 → 切下一鏡(複製整疊、保留父子、對齊下個標記)
//   預覽   對畫面卡時:關陰影/模糊、降解析度、工作區框到本鏡、靜圖代理

(function (thisObj) {

    // ================= 共用 =================

    var statusLabel = null;
    function showStatus(msg) {
        try { if (statusLabel) { statusLabel.text = msg; statusLabel.helpTip = msg; } } catch (e) {}
    }

    function activeComp() {
        var c = app.project ? app.project.activeItem : null;
        if (!(c instanceof CompItem)) { alert("請先點一下要操作的合成時間軸。"); return null; }
        return c;
    }

    function posProp(layer)   { return layer.property("ADBE Transform Group").property("ADBE Position"); }
    function scaleProp(layer) { return layer.property("ADBE Transform Group").property("ADBE Scale"); }

    // 給 Position/Scale 這類多維屬性的所有 key 套「緩入緩出」(Easy Ease)
    function easyEaseProp(prop) {
        try {
            var n = prop.numKeys;
            for (var k = 1; k <= n; k++) {
                var dims = 1;
                try { dims = prop.value.length || 1; } catch (eD) { dims = 1; }
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

    // ================= 運鏡 =================

    // 在目前時間,對選取的鏡頭層把現在的 Position+Scale 記成一個 key。
    // 起幀、迄幀都用它;迄幀時順手把整條 pos/scale 套緩入緩出。
    function camSetKey(applyEase) {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取鏡頭層(運鏡用的 BG 或 Null),再按。"); return; }
        var t = comp.time;
        app.beginUndoGroup("運鏡:設幀");
        try {
            for (var i = 0; i < sel.length; i++) {
                var p = posProp(sel[i]), s = scaleProp(sel[i]);
                p.setValueAtTime(t, p.valueAtTime(t, false));
                s.setValueAtTime(t, s.valueAtTime(t, false));
                if (applyEase) { easyEaseProp(p); easyEaseProp(s); }
            }
        } finally { app.endUndoGroup(); }
        showStatus(applyEase
            ? "已設迄幀並套緩入緩出。運鏡完成,可直接預覽。"
            : "已設起幀(目前畫面)。移到鏡頭結尾、重新框好後按「設迄幀」。");
    }

    // 微運鏡快捷:對選取鏡頭層,在 [目前時間 → 該層出點] 之間自動補一段慢推/拉/搖,並套緩動。
    function camPreset(kind) {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取鏡頭層(BG/Null),再按微運鏡。"); return; }
        var t0 = comp.time;
        app.beginUndoGroup("微運鏡:" + kind);
        try {
            for (var i = 0; i < sel.length; i++) {
                var lay = sel[i];
                var t1 = lay.outPoint;
                if (!(t1 > t0)) t1 = t0 + 4; // 出點抓不到就預設 4 秒
                var p = posProp(lay), s = scaleProp(lay);
                var pv = p.valueAtTime(t0, false), sv = s.valueAtTime(t0, false);
                var drift = 0.12;                          // 縮放幅度 12%
                var pan = (comp.width || 1920) * 0.06;     // 平移幅度 ≈ 畫面 6%
                var pEnd = pv.slice(), sEnd = sv.slice();
                if (kind === "推")      { sEnd[0] = sv[0] * (1 + drift); sEnd[1] = sv[1] * (1 + drift); }
                else if (kind === "拉") { sEnd[0] = sv[0] * (1 - drift); sEnd[1] = sv[1] * (1 - drift); }
                else if (kind === "左") { pEnd[0] = pv[0] + pan; }      // 鏡頭左移 = 內容右移
                else if (kind === "右") { pEnd[0] = pv[0] - pan; }
                s.setValueAtTime(t0, sv); s.setValueAtTime(t1, sEnd);
                p.setValueAtTime(t0, pv); p.setValueAtTime(t1, pEnd);
                easyEaseProp(s); easyEaseProp(p);
            }
        } finally { app.endUndoGroup(); }
        showStatus("已套「慢" + kind + "」微運鏡(目前時間 → 鏡頭出點),已套緩動。");
    }

    // ================= 切鏡 =================

    // 一鍵切下一鏡:複製選取的整疊圖層(保留彼此父子關係),整段移到「本鏡結尾 → 下個標記」。
    // markerSrc: "comp" 用合成標記;"audio" 用選取音檔圖層上的 marker。
    function cutNextShot(markerSrc) {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取目前這一鏡的整疊圖層(可全選),再按「切下一鏡」。"); return; }

        // 本鏡範圍 = 選取圖層的最小入點 / 最大出點
        var shotEnd = -Infinity, shotStart = Infinity;
        for (var a = 0; a < sel.length; a++) {
            if (sel[a].outPoint > shotEnd) shotEnd = sel[a].outPoint;
            if (sel[a].inPoint < shotStart) shotStart = sel[a].inPoint;
        }

        // 找「shotEnd 之後最近的標記」
        var nextMark = null;
        function scanMarkers(mp) {
            try {
                for (var m = 1; m <= mp.numKeys; m++) {
                    var mt = mp.keyTime(m);
                    if (mt > shotEnd + 0.001 && (nextMark === null || mt < nextMark)) nextMark = mt;
                }
            } catch (e) {}
        }
        if (markerSrc === "audio") {
            // 用選取圖層裡找到的第一個有 marker 的圖層(通常是音檔)
            for (var s = 0; s < sel.length; s++) {
                try {
                    var lm = sel[s].property("ADBE Marker");
                    if (lm && lm.numKeys > 0) scanMarkers(lm);
                } catch (eL) {}
            }
            // 選取裡沒 marker → 掃整個 comp 所有圖層的 marker
            if (nextMark === null) {
                for (var li = 1; li <= comp.numLayers; li++) {
                    try {
                        var lm2 = comp.layer(li).property("ADBE Marker");
                        if (lm2 && lm2.numKeys > 0) scanMarkers(lm2);
                    } catch (eL2) {}
                }
            }
        } else {
            scanMarkers(comp.markerProperty);
        }

        var newStart = shotEnd;
        var newEnd = (nextMark !== null) ? nextMark : shotEnd + (shotEnd - shotStart);

        app.beginUndoGroup("切下一鏡");
        try {
            // 先全部複製,建立 原圖層 → 新圖層 對照(用來重連內部父子)
            var pairs = [];
            for (var i = 0; i < sel.length; i++) {
                pairs.push({ orig: sel[i], dup: sel[i].duplicate() });
            }
            // 內部父子重連:原本 parent 也在選取群裡 → 改指到對應的新圖層
            for (var j = 0; j < pairs.length; j++) {
                var origParent = pairs[j].orig.parent;
                if (!origParent) continue;
                for (var q = 0; q < pairs.length; q++) {
                    if (pairs[q].orig === origParent) { pairs[j].dup.parent = pairs[q].dup; break; }
                }
            }
            // 整段平移到 newStart,並把出點收到 newEnd
            var delta = newStart - shotStart;
            var newSel = [];
            for (var d = 0; d < pairs.length; d++) {
                var L = pairs[d].dup;
                try { L.startTime += delta; } catch (eS) {}
                try { if (L.outPoint > newEnd) L.outPoint = newEnd; } catch (eO) {}
                try { if (L.inPoint < newStart) L.inPoint = newStart; } catch (eI) {}
                newSel.push(L);
            }
            // 選起新鏡頭、把時間移到新鏡開頭,方便接著運鏡
            for (var u = 1; u <= comp.numLayers; u++) comp.layer(u).selected = false;
            for (var v = 0; v < newSel.length; v++) newSel[v].selected = true;
            comp.time = newStart;
        } finally { app.endUndoGroup(); }
        showStatus("已切下一鏡:複製 " + sel.length + " 個圖層 → " +
            newStart.toFixed(2) + "s ~ " + newEnd.toFixed(2) + "s" +
            (nextMark !== null ? "(對齊下個標記)" : "(找不到標記,沿用本鏡長度)") +
            "。新鏡已選起,直接運鏡即可。");
    }

    // ================= 預覽效能 =================

    // 每鏡單獨預覽:把工作區框到「選取圖層的範圍」
    function shotToWorkArea() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取這一鏡的圖層,再按(用來框工作區)。"); return; }
        var s = Infinity, e = -Infinity;
        for (var i = 0; i < sel.length; i++) {
            if (sel[i].inPoint < s) s = sel[i].inPoint;
            if (sel[i].outPoint > e) e = sel[i].outPoint;
        }
        app.beginUndoGroup("工作區框到本鏡");
        try {
            comp.workAreaStart = Math.max(0, s);
            comp.workAreaDuration = Math.max(0.1, Math.min(e, comp.duration) - Math.max(0, s));
        } finally { app.endUndoGroup(); }
        showStatus("工作區已框到本鏡(" + comp.workAreaStart.toFixed(2) + "s ~ " +
            (comp.workAreaStart + comp.workAreaDuration).toFixed(2) + "s)。按數字 0 只預覽這一鏡。");
    }

    // 預覽解析度切換(Full=1 / Half=2 / Third=3)
    function setPreviewRes(factor) {
        var comp = activeComp(); if (!comp) return;
        try { comp.resolutionFactor = [factor, factor]; } catch (e) {}
        var label = (factor === 1) ? "Full" : (factor === 2 ? "Half" : "Third");
        showStatus("預覽解析度已切到 " + label + "。對畫面時用低解析度、輸出前記得切回 Full。");
    }

    // 編輯時關特效:把目前合成裡的 Drop Shadow/模糊效果 + 調整圖層暫時關掉,讓對畫面變順。
    // on=false 關、on=true 開回來。
    function toggleHeavyFx(on) {
        var comp = activeComp(); if (!comp) return;
        app.beginUndoGroup(on ? "開回陰影/調整層" : "編輯模式:關陰影/調整層");
        var fxCount = 0, adjCount = 0;
        try {
            for (var i = 1; i <= comp.numLayers; i++) {
                var lay = comp.layer(i);
                if (lay.adjustmentLayer) { try { lay.enabled = on; adjCount++; } catch (eA) {} }
                var fx;
                try { fx = lay.property("ADBE Effect Parade"); } catch (eP) { fx = null; }
                if (!fx) continue;
                for (var f = 1; f <= fx.numProperties; f++) {
                    var ef = fx.property(f);
                    var nm = (ef.matchName || "") + " " + (ef.name || "");
                    if (/Drop Shadow|Gaussian Blur|Fast Blur|Box Blur/i.test(nm)) {
                        try { ef.enabled = on; fxCount++; } catch (eE) {}
                    }
                }
            }
        } finally { app.endUndoGroup(); }
        showStatus((on ? "已開回 " : "已關閉 ") + fxCount + " 個陰影/模糊效果、" +
            adjCount + " 個調整層" + (on ? "。" : "(編輯時用,輸出前按「還原特效」)。"));
    }

    // 靜圖代理:把選取圖層的「來源合成」算成一張 PNG 當 proxy,預覽輕量、輸出可切回。
    // 只適合「不會動的大插圖 precomp」;內含動畫(眨眼/嘴)的套了會凍結。
    function makeStillProxy() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取要做代理的圖層(來源是合成的大插圖),再按。"); return; }

        var dir;
        try {
            dir = (app.project.file)
                ? new Folder(app.project.file.parent.fsName + "/_proxy")
                : new Folder(Folder.temp.fsName + "/AE_proxy");
            if (!dir.exists) dir.create();
        } catch (eF) { alert("無法建立 proxy 資料夾。"); return; }

        var done = 0, skip = [];
        app.beginUndoGroup("建立靜圖代理");
        try {
            for (var i = 0; i < sel.length; i++) {
                var src = sel[i].source;
                if (!(src instanceof CompItem)) { skip.push(sel[i].name + "(來源不是合成)"); continue; }
                try {
                    var f = new File(dir.fsName + "/" + src.name.replace(/[\\\/:*?"<>|]/g, "_") + "_proxy.png");
                    src.saveFrameToPng(src.time, f);
                    src.setProxy(f);
                    done++;
                } catch (eS) { skip.push(sel[i].name + "(算圖失敗)"); }
            }
        } finally { app.endUndoGroup(); }
        showStatus("已對 " + done + " 個來源合成建立靜圖代理(預覽變輕)。" +
            (skip.length ? "略過:" + skip.join("、") + "。" : "") +
            "輸出前要原圖,用「代理 關」切掉。");
    }

    // 切換選取圖層來源的 proxy 開/關
    function toggleProxyUse(use) {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取圖層,再切換代理開/關。"); return; }
        var n = 0;
        for (var i = 0; i < sel.length; i++) {
            var src = sel[i].source;
            try { if (src && src.hasProxy) { src.useProxy = use; n++; } } catch (e) {}
        }
        showStatus("已把 " + n + " 個來源的代理切到「" + (use ? "開(輕量預覽)" : "關(原圖)") + "」。");
    }

    // ================= UI =================

    function buildUI(thisObj) {
        var pal = (thisObj instanceof Panel) ? thisObj
                : new Window("palette", "分鏡工具 v1.0", undefined, { resizeable: true });
        pal.orientation = "column";
        pal.alignChildren = ["fill", "top"];
        pal.spacing = 6; pal.margins = 8;

        function section(title) {
            var p = pal.add("panel", undefined, title);
            p.orientation = "column";
            p.alignChildren = ["fill", "top"];
            p.spacing = 4; p.margins = 8;
            return p;
        }

        // ── 運鏡 ──
        var secCam = section("運鏡(選鏡頭層 BG/Null)");
        secCam.add("statictext", undefined, "開頭框好→設起幀;結尾框好→設迄幀(自動補 Position+Scale+緩動)");
        var rowCam = secCam.add("group");
        var bCamIn  = rowCam.add("button", undefined, "設起幀");      bCamIn.preferredSize.width = 90;
        var bCamOut = rowCam.add("button", undefined, "設迄幀+緩動"); bCamOut.preferredSize.width = 110;
        bCamIn.onClick  = function () { camSetKey(false); };
        bCamOut.onClick = function () { camSetKey(true); };
        var rowCam2 = secCam.add("group");
        rowCam2.add("statictext", undefined, "微運鏡:").preferredSize.width = 56;
        var bPush = rowCam2.add("button", undefined, "慢推"); bPush.preferredSize.width = 56;
        var bPull = rowCam2.add("button", undefined, "慢拉"); bPull.preferredSize.width = 56;
        var bPanL = rowCam2.add("button", undefined, "左搖"); bPanL.preferredSize.width = 56;
        var bPanR = rowCam2.add("button", undefined, "右搖"); bPanR.preferredSize.width = 56;
        bPush.onClick = function () { camPreset("推"); };
        bPull.onClick = function () { camPreset("拉"); };
        bPanL.onClick = function () { camPreset("左"); };
        bPanR.onClick = function () { camPreset("右"); };

        // ── 切鏡 ──
        var secCut = section("切鏡(選整疊圖層)");
        secCut.add("statictext", undefined, "複製整疊→保留父子→對齊下個標記。標記來源:");
        var rowCutSrc = secCut.add("group");
        var radComp  = rowCutSrc.add("radiobutton", undefined, "合成標記");
        var radAudio = rowCutSrc.add("radiobutton", undefined, "音檔圖層 marker");
        radComp.value = true;
        var rowCut = secCut.add("group");
        var bCut = rowCut.add("button", undefined, "切下一鏡"); bCut.preferredSize.width = 200;
        bCut.onClick = function () { cutNextShot(radAudio.value ? "audio" : "comp"); };

        // ── 預覽效能 ──
        var secPv = section("預覽效能(對畫面卡時用)");
        var rowFx = secPv.add("group");
        rowFx.add("statictext", undefined, "特效:").preferredSize.width = 56;
        var bFxOff = rowFx.add("button", undefined, "編輯模式(關陰影/模糊)"); bFxOff.preferredSize.width = 160;
        var bFxOn  = rowFx.add("button", undefined, "還原特效"); bFxOn.preferredSize.width = 80;
        bFxOff.onClick = function () { toggleHeavyFx(false); };
        bFxOn.onClick  = function () { toggleHeavyFx(true); };

        var rowRes = secPv.add("group");
        rowRes.add("statictext", undefined, "解析度:").preferredSize.width = 56;
        var bResH = rowRes.add("button", undefined, "Half");  bResH.preferredSize.width = 56;
        var bResT = rowRes.add("button", undefined, "Third"); bResT.preferredSize.width = 56;
        var bResF = rowRes.add("button", undefined, "Full");  bResF.preferredSize.width = 56;
        bResH.onClick = function () { setPreviewRes(2); };
        bResT.onClick = function () { setPreviewRes(3); };
        bResF.onClick = function () { setPreviewRes(1); };

        var rowWA = secPv.add("group");
        rowWA.add("statictext", undefined, "預覽:").preferredSize.width = 56;
        var bWA = rowWA.add("button", undefined, "工作區框到本鏡"); bWA.preferredSize.width = 160;
        bWA.onClick = shotToWorkArea;

        var rowPx = secPv.add("group");
        rowPx.add("statictext", undefined, "代理:").preferredSize.width = 56;
        var bPxMake = rowPx.add("button", undefined, "建靜圖代理"); bPxMake.preferredSize.width = 90;
        var bPxOff  = rowPx.add("button", undefined, "代理關"); bPxOff.preferredSize.width = 56;
        var bPxOn   = rowPx.add("button", undefined, "代理開"); bPxOn.preferredSize.width = 56;
        bPxMake.onClick = makeStillProxy;
        bPxOff.onClick  = function () { toggleProxyUse(false); };
        bPxOn.onClick   = function () { toggleProxyUse(true); };
        secPv.add("statictext", undefined, "代理只給「不會動的大插圖」;會動的(眨眼/嘴)套了會凍結");

        statusLabel = pal.add("statictext", undefined, "就緒", { truncate: "end" });
        statusLabel.alignment = ["fill", "bottom"];

        pal.layout.layout(true);
        if (pal instanceof Window) {
            pal.onResizing = pal.onResize = function () { this.layout.resize(); };
        }
        return pal;
    }

    var ui = buildUI(thisObj);
    if (ui instanceof Window) { ui.center(); ui.show(); }

})(this);
