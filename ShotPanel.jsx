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

    // 鏡頭抖動:在選取圖層的 Position 上打幾個隨機小偏移 key,模擬手持。
    // 抖動範圍 ±shakePx px,每 stepSec 秒一個 key,持續 durSec 秒。
    function camShake(shakePx, stepSec, durSec) {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取鏡頭層(BG/Null),再按抖動。"); return; }
        app.beginUndoGroup("鏡頭抖動");
        try {
            for (var i = 0; i < sel.length; i++) {
                var p = posProp(sel[i]);
                var t0 = comp.time;
                var base = p.valueAtTime(t0, false);
                var steps = Math.max(2, Math.round(durSec / stepSec));
                for (var k = 0; k <= steps; k++) {
                    var t = t0 + k * stepSec;
                    var dx = (k === 0 || k === steps) ? 0 : (Math.random() * 2 - 1) * shakePx;
                    var dy = (k === 0 || k === steps) ? 0 : (Math.random() * 2 - 1) * shakePx;
                    var v = base.slice();
                    v[0] = base[0] + dx; v[1] = base[1] + dy;
                    p.setValueAtTime(t, v);
                }
            }
        } finally { app.endUndoGroup(); }
        showStatus("已加入鏡頭抖動(" + durSec + "s,±" + shakePx + "px)。可 Ctrl+Z 整組撤銷。");
    }

    // Overshoot 緩動:把選取鏡頭層 Position+Scale 已有的 key 換成帶彈跳的緩動
    // 做法:Easy Ease 基礎上,把「影響力」拉高(influence=80~90),讓緩出更猛、緩入更慢
    // 並在最後一個 key 之前插入一個小的 overshoot key。
    function applyOvershoot() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取鏡頭層,再按 Overshoot。"); return; }
        app.beginUndoGroup("Overshoot 緩動");
        try {
            for (var i = 0; i < sel.length; i++) {
                var props = [posProp(sel[i]), scaleProp(sel[i])];
                for (var pi = 0; pi < props.length; pi++) {
                    var prop = props[pi];
                    var n = prop.numKeys;
                    if (n < 2) continue;
                    // 在倒數第二個 key 和最後一個 key 之間插入 overshoot key
                    var tLast = prop.keyTime(n);
                    var tPrev = prop.keyTime(n - 1);
                    var tOver = tLast - (tLast - tPrev) * 0.15; // 距離終點 15% 處
                    var vLast = prop.valueAtTime(tLast, false);
                    var vPrev = prop.valueAtTime(tPrev, false);
                    // overshoot 值:稍微超過終點值
                    var vOver = vLast.slice ? vLast.slice() : [vLast];
                    var vL2   = vLast.slice ? vLast.slice() : [vLast];
                    var vP2   = vPrev.slice ? vPrev.slice() : [vPrev];
                    for (var di = 0; di < vOver.length; di++) {
                        vOver[di] = vL2[di] + (vL2[di] - vP2[di]) * 0.06;
                    }
                    prop.setValueAtTime(tOver, vOver.length === 1 ? vOver[0] : vOver);
                    // 把所有 key 套強力緩動(influence 80)
                    var n2 = prop.numKeys;
                    for (var k = 1; k <= n2; k++) {
                        var dims = 1;
                        try { dims = prop.value.length || 1; } catch (eD) { dims = 1; }
                        var inE = [], outE = [];
                        for (var d = 0; d < dims; d++) {
                            inE.push(new KeyframeEase(0, 80));
                            outE.push(new KeyframeEase(0, 80));
                        }
                        prop.setInterpolationTypeAtKey(k,
                            KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
                        try { prop.setTemporalEaseAtKey(k, inE, outE); } catch (eE) {}
                    }
                }
            }
        } finally { app.endUndoGroup(); }
        showStatus("已套 Overshoot 緩動(Position+Scale)。有彈跳感,輸出前確認看看。");
    }

    // 軸心置中:把選取圖層的錨點移到合成正中央(畫面中心),且自動補償 Position 讓
    // 內容不位移。對運鏡層特別有用——推拉/旋轉就會以畫面中心為基準。
    // 已考慮目前的 Scale 與 Z 旋轉;預期用在「沒有父層」的鏡頭層(BG/Null)。
    function anchorToCompCenter() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取要置中軸心的圖層,再按。"); return; }
        var cx = comp.width / 2, cy = comp.height / 2;
        app.beginUndoGroup("軸心置中合成");
        var withParent = 0, skipKeys = 0, done = 0;
        try {
            for (var i = 0; i < sel.length; i++) {
                var lay = sel[i];
                var aP = lay.property("ADBE Transform Group").property("ADBE Anchor Point");
                var pP = lay.property("ADBE Transform Group").property("ADBE Position");
                var sP = lay.property("ADBE Transform Group").property("ADBE Scale");
                var rP = lay.property("ADBE Transform Group").property("ADBE Rotate Z");
                // 已有 Position/Anchor 關鍵影格時跳過:此時錨點無法「全程都在中心」,
                // 而且 setValue 會報錯。軸心置中請在加運鏡 key 之前做。
                if ((pP.numKeys > 0) || (aP.numKeys > 0)) { skipKeys++; continue; }
                if (lay.parent) { withParent++; }      // 有父層仍照做,但提醒可能不準
                var A = aP.value, P = pP.value, S = sP.value;
                var r = 0; try { r = rP.value * Math.PI / 180; } catch (eR) { r = 0; }
                var sx = (S[0] || 100) / 100, sy = (S[1] || 100) / 100;
                // dv = 想讓錨點落到的畫面點(comp 中心) − 目前 Position(=錨點目前所在畫面點)
                var dvx = cx - P[0], dvy = cy - P[1];
                // 反旋轉
                var c = Math.cos(-r), s = Math.sin(-r);
                var rx = dvx * c - dvy * s, ry = dvx * s + dvy * c;
                // 除以縮放 → 換算到圖層空間的位移
                rx = rx / (sx || 1); ry = ry / (sy || 1);
                var newA = [A[0] + rx, A[1] + ry];
                if (A.length > 2) newA.push(A[2]);
                var newP = [cx, cy];
                if (P.length > 2) newP.push(P[2]);
                aP.setValue(newA);
                pP.setValue(newP);
                done++;
            }
        } finally { app.endUndoGroup(); }
        showStatus("已把 " + done + " 個圖層的軸心移到合成中央(內容不位移)。" +
            (withParent ? "(其中 " + withParent + " 個有父層,結果可能略有偏差)" : "") +
            (skipKeys ? " 跳過 " + skipKeys + " 個(已有 Position/Anchor 關鍵影格,請在加運鏡前先置中)。" : ""));
    }

    // Solo 切換:Solo 選取圖層(取消其他圖層 solo),或還原。
    // 快取存「圖層參考 + 所屬 comp」,避免換 comp 或增刪圖層後用 index 還原到錯的圖層。
    var _soloCache = null; // { comp: CompItem, items: [{ layer, solo }] }
    function soloShot(on) {
        var comp = activeComp(); if (!comp) return;
        if (on) {
            var sel = comp.selectedLayers;
            if (sel.length === 0) { alert("先選取本鏡圖層,再按 Solo。"); return; }
            var items = [];
            for (var i = 1; i <= comp.numLayers; i++) {
                var lay = comp.layer(i);
                items.push({ layer: lay, solo: lay.solo });
                lay.solo = false;
            }
            _soloCache = { comp: comp, items: items };
            for (var j = 0; j < sel.length; j++) { try { sel[j].solo = true; } catch (e) {} }
            showStatus("Solo 本鏡(" + sel.length + " 個圖層)。按「還原 Solo」回到原狀。");
        } else {
            // 只有快取屬於目前 comp 時才照原狀還原;否則只把目前 comp 的 solo 全清掉
            if (_soloCache && _soloCache.comp === comp) {
                for (var k = 0; k < _soloCache.items.length; k++) {
                    try { _soloCache.items[k].layer.solo = _soloCache.items[k].solo; } catch (e) {}
                }
                _soloCache = null;
                showStatus("已還原 Solo。");
            } else {
                for (var m = 1; m <= comp.numLayers; m++) {
                    try { comp.layer(m).solo = false; } catch (e) {}
                }
                showStatus("已清除本合成所有 Solo。");
            }
        }
    }

    // ================= 切鏡 =================

    // 在「播放頭 / 下個標記」把選取的整疊圖層切成兩鏡:
    //   原圖層出點 = 切點(前一鏡到此結束)
    //   複製出的新圖層入點 = 切點(後一鏡從此開始),且整疊集中移到原圖層上方
    // 不會「舊新舊新」交錯,複製出的整疊會排在一起。
    // useMarker=false:切在播放頭;true:切在播放頭之後最近的標記(markerSrc 決定來源)。
    function cutShot(useMarker, markerSrc) {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取要切的整疊圖層(可全選),再按。"); return; }

        var T = comp.time;
        if (useMarker) {
            var nextMark = null;
            function scanMarkers(mp) {
                try {
                    for (var m = 1; m <= mp.numKeys; m++) {
                        var mt = mp.keyTime(m);
                        if (mt > T + 0.001 && (nextMark === null || mt < nextMark)) nextMark = mt;
                    }
                } catch (e) {}
            }
            if (markerSrc === "audio") {
                for (var s = 0; s < sel.length; s++) {
                    try { var lm = sel[s].property("ADBE Marker"); if (lm && lm.numKeys > 0) scanMarkers(lm); } catch (eL) {}
                }
                if (nextMark === null) {
                    for (var li = 1; li <= comp.numLayers; li++) {
                        try { var lm2 = comp.layer(li).property("ADBE Marker"); if (lm2 && lm2.numKeys > 0) scanMarkers(lm2); } catch (eL2) {}
                    }
                }
            } else {
                scanMarkers(comp.markerProperty);
            }
            if (nextMark === null) { alert("播放頭之後找不到標記。先下標記,或改用「切在播放頭」。"); return; }
            T = nextMark;
        }

        // 依圖層順序(index 小→大,上→下)排序,確保複製出的整疊維持原本上下關係
        var ordered = sel.slice().sort(function (a, b) { return a.index - b.index; });

        app.beginUndoGroup("切鏡");
        try {
            // 複製,建立 原→新 對照(用來重連內部父子)
            var pairs = [];
            for (var i = 0; i < ordered.length; i++) {
                pairs.push({ orig: ordered[i], dup: ordered[i].duplicate() });
            }
            // 內部父子重連:原本 parent 也在選取群裡 → 改指到對應的新圖層
            for (var j = 0; j < pairs.length; j++) {
                var op = pairs[j].orig.parent;
                if (!op) continue;
                for (var q = 0; q < pairs.length; q++) {
                    if (pairs[q].orig === op) { pairs[j].dup.parent = pairs[q].dup; break; }
                }
            }
            // 切點:原圖層收到切點前、新圖層從切點起
            var topOrig = pairs[0].orig; // index 最小的原圖層(最上面)
            for (var d = 0; d < pairs.length; d++) {
                var O = pairs[d].orig, N = pairs[d].dup;
                try { if (O.inPoint < T && O.outPoint > T) O.outPoint = T; } catch (eO) {}
                try { if (N.outPoint > T && N.inPoint < T) N.inPoint = T; } catch (eN) {}
                // 把新圖層集中移到原整疊上方(依序,維持彼此順序)
                try { N.moveBefore(topOrig); } catch (eM) {}
            }
            // 選起新整疊、播放頭移到切點,接著就能運鏡
            for (var u = 1; u <= comp.numLayers; u++) comp.layer(u).selected = false;
            for (var v = 0; v < pairs.length; v++) pairs[v].dup.selected = true;
            comp.time = T;
            // 自動把工作區框到新鏡(入點=切點,出點=新整疊最大出點),按 0 即可預覽
            var newEnd = T;
            for (var w = 0; w < pairs.length; w++) {
                try { if (pairs[w].dup.outPoint > newEnd) newEnd = pairs[w].dup.outPoint; } catch (eW) {}
            }
            try { comp.workAreaStart = T; comp.workAreaDuration = Math.max(0.1, newEnd - T); } catch (eWA) {}
        } finally { app.endUndoGroup(); }
        showStatus("已在 " + T.toFixed(2) + "s 切鏡,新整疊排上方已選起;工作區已框到新鏡,按 0 預覽。");
    }

    // 在目前時間下一個標記,完全不靠鍵盤(避開中文輸入法吃掉 * 的問題)。
    // target: "comp" 下在合成標記;"audio" 下在選取的圖層(通常是音檔)上。
    function addMarkerNow(target) {
        var comp = activeComp(); if (!comp) return;
        var t = comp.time;
        app.beginUndoGroup("下標記");
        var made = 0;
        try {
            if (target === "audio") {
                var sel = comp.selectedLayers;
                if (sel.length === 0) { alert("先選取要下標記的圖層(通常是音檔),再按。"); app.endUndoGroup(); return; }
                for (var i = 0; i < sel.length; i++) {
                    try { sel[i].property("ADBE Marker").setValueAtTime(t, new MarkerValue("")); made++; } catch (e) {}
                }
            } else {
                comp.markerProperty.setValueAtTime(t, new MarkerValue(""));
                made = 1;
            }
        } finally { app.endUndoGroup(); }
        showStatus("已在 " + t.toFixed(2) + "s 下 " + made + " 個標記(" +
            (target === "audio" ? "選取圖層上" : "合成") + ")。");
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

    // 工作區還原成整段(全片)
    function fullWorkArea() {
        var comp = activeComp(); if (!comp) return;
        try { comp.workAreaStart = 0; comp.workAreaDuration = comp.duration; } catch (e) {}
        showStatus("工作區已還原為整段(0 ~ " + comp.duration.toFixed(2) + "s)。");
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

    // ================= 圖層工具 =================

    // 一鍵清除選取圖層上的所有效果
    function clearEffects() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取要清效果的圖層,再按。"); return; }
        app.beginUndoGroup("清除效果");
        var removed = 0;
        try {
            for (var i = 0; i < sel.length; i++) {
                var fx;
                try { fx = sel[i].property("ADBE Effect Parade"); } catch (eP) { fx = null; }
                if (!fx) continue;
                // 由後往前刪,避免 index 位移
                for (var f = fx.numProperties; f >= 1; f--) {
                    try { fx.property(f).remove(); removed++; } catch (eR) {}
                }
            }
        } finally { app.endUndoGroup(); }
        showStatus("已清除 " + removed + " 個效果(" + sel.length + " 個圖層)。");
    }

    // 淡入 / 淡出:在選取圖層的 Opacity 上補關鍵影格,並套緩入緩出。
    // mode: "in" 入點起淡入、"out" 出點前淡出、"both" 兩端都做。durSec 為過場長度。
    function addFade(mode, durSec) {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取要淡入/淡出的圖層,再按。"); return; }
        app.beginUndoGroup("淡入淡出:" + mode);
        try {
            for (var i = 0; i < sel.length; i++) {
                var op = sel[i].property("ADBE Transform Group").property("ADBE Opacity");
                if (!op) continue;
                var tIn = sel[i].inPoint, tOut = sel[i].outPoint;
                var dur = Math.min(durSec, Math.max(0.01, (tOut - tIn) / 2));
                if (mode === "in" || mode === "both") {
                    op.setValueAtTime(tIn, 0);
                    op.setValueAtTime(tIn + dur, 100);
                }
                if (mode === "out" || mode === "both") {
                    op.setValueAtTime(tOut - dur, 100);
                    op.setValueAtTime(tOut, 0);
                }
                easyEaseProp(op);
            }
        } finally { app.endUndoGroup(); }
        showStatus("已套" + (mode === "in" ? "淡入" : mode === "out" ? "淡出" : "淡入淡出") +
            "(" + durSec + "s," + sel.length + " 個圖層)。");
    }

    // 拆解輔助:對選取的「預合成圖層」建一顆 Null,完全複製它的位置/縮放/旋轉/錨點。
    // 之後把預合成裡的內層圖層複製→貼到主合成→全選 parent 到這顆 Null,
    // 內層就會維持原本在畫面上的位置(不位移)。
    function makeCompensationNull() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length !== 1) { alert("只選「一個」預合成圖層,再按。"); return; }
        var src = sel[0];
        app.beginUndoGroup("建立對齊 Null");
        var nul;
        try {
            nul = comp.layers.addNull();
            nul.name = "對齊_" + src.name;
            var tg = nul.property("ADBE Transform Group");
            var stg = src.property("ADBE Transform Group");
            // 逐項複製(用目前時間的值,避免被 key 影響)
            var t = comp.time;
            var names = ["ADBE Anchor Point", "ADBE Position", "ADBE Scale", "ADBE Rotate Z"];
            for (var i = 0; i < names.length; i++) {
                try { tg.property(names[i]).setValue(stg.property(names[i]).valueAtTime(t, false)); } catch (e) {}
            }
            // 3D 圖層的話補方向/X/Y 旋轉
            if (src.threeDLayer) {
                try { nul.threeDLayer = true; } catch (e3) {}
                var n3 = ["ADBE Orientation", "ADBE Rotate X", "ADBE Rotate Y"];
                for (var j = 0; j < n3.length; j++) {
                    try { tg.property(n3[j]).setValue(stg.property(n3[j]).valueAtTime(t, false)); } catch (e) {}
                }
            }
            nul.selected = true;
        } finally { app.endUndoGroup(); }
        showStatus("已建「" + (nul ? nul.name : "對齊 Null") + "」。" +
            "做法:進預合成複製內層→回主合成貼上→全選貼好的圖層,parent 到這顆 Null,位置就會吻合。" +
            "(注意:不透明度、混合模式、效果不會經由 Null 繼承)");
    }

    // 淡黑/淡白過場(dip):在播放頭放一片固態色蓋全畫面,opacity 0→100→0。
    // 不用 precomp、不碰任何圖層透明度,整疊都吃得到。前段淡到色、後段從色淡出。
    // rgb 例:[0,0,0] 黑、[1,1,1] 白。durSec = 整段過場長度(前後各半)。
    function dipTransition(rgb, durSec) {
        var comp = activeComp(); if (!comp) return;
        var t = comp.time;
        var half = durSec / 2;
        var start = Math.max(0, t - half);
        var end = Math.min(comp.duration, t + half);
        app.beginUndoGroup("淡色過場");
        try {
            var name = (rgb[0] >= 0.5 ? "淡白過場" : "淡黑過場");
            var solid = comp.layers.addSolid(rgb, name, comp.width, comp.height, 1);
            solid.moveToBeginning();           // 蓋在最上層
            solid.startTime = start;
            solid.inPoint = start;
            solid.outPoint = end;
            var op = solid.property("ADBE Transform Group").property("ADBE Opacity");
            op.setValueAtTime(start, 0);
            op.setValueAtTime(t, 100);
            op.setValueAtTime(end, 0);
            easyEaseProp(op);
        } finally { app.endUndoGroup(); }
        showStatus("已在 " + t.toFixed(2) + "s 加" + (rgb[0] >= 0.5 ? "淡白" : "淡黑") +
            "過場(" + durSec + "s)。整疊都吃得到,不用 precomp、不碰圖層透明度。");
    }

    // 整疊淡出控制 Null:把選取圖層的 opacity 用表達式接到一顆 Null 的 opacity,
    // 之後只要 keyframe 那顆 Null 就能讓整疊一起淡。並預設打好淡入/淡出 key。
    // 注意:這跟逐層拉透明度本質相同,圖層重疊處仍會穿幫;不重疊時最好用。
    function linkOpacityToNull() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length === 0) { alert("先選取整疊圖層,再按。"); return; }
        app.beginUndoGroup("淡出控制 Null");
        try {
            // 取唯一名稱,避免表達式抓錯
            var base = "淡出控制", nm = base, n = 1;
            function nameUsed(x) { for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === x) return true; return false; }
            while (nameUsed(nm)) { nm = base + "_" + (++n); }

            var ctrl = comp.layers.addNull();
            ctrl.name = nm;
            ctrl.moveToBeginning();

            // 整疊範圍 → 給控制 Null 預設淡入/淡出 key(各 0.5s)
            var tIn = Infinity, tOut = -Infinity;
            for (var a = 0; a < sel.length; a++) {
                if (sel[a].inPoint < tIn) tIn = sel[a].inPoint;
                if (sel[a].outPoint > tOut) tOut = sel[a].outPoint;
            }
            var dur = Math.min(0.5, Math.max(0.01, (tOut - tIn) / 2));
            var cop = ctrl.property("ADBE Transform Group").property("ADBE Opacity");
            cop.setValueAtTime(tIn, 0);
            cop.setValueAtTime(tIn + dur, 100);
            cop.setValueAtTime(tOut - dur, 100);
            cop.setValueAtTime(tOut, 0);
            easyEaseProp(cop);

            // 每層 opacity 接到控制 Null
            var expr = 'thisComp.layer("' + nm + '").transform.opacity';
            for (var i = 0; i < sel.length; i++) {
                try { sel[i].property("ADBE Transform Group").property("ADBE Opacity").expression = expr; } catch (e) {}
            }
        } finally { app.endUndoGroup(); }
        showStatus("已建「" + nm + "」並把 " + sel.length +
            " 層 opacity 接上(已預設淡入淡出)。改那顆 Null 的 opacity 即可控整疊。" +
            "重疊圖層會穿幫,不重疊時最佳。");
    }

    // 複製單一屬性值(含關鍵影格 / 表達式)
    function copyPropValue(sp, dp) {
        if (!sp || !dp) return;
        try {
            if (sp.numKeys && sp.numKeys > 0) {
                for (var k = 1; k <= sp.numKeys; k++) {
                    try { dp.setValueAtTime(sp.keyTime(k), sp.keyValue(k)); } catch (e) {}
                }
            } else {
                try { dp.setValue(sp.value); } catch (e) {}
            }
            try { if (sp.expression) dp.expression = sp.expression; } catch (e) {}
        } catch (e) {}
    }

    // 遞迴複製群組底下的所有屬性(用 matchName 對應),處理巢狀群組(如圖層樣式)。
    function copyGroupRecursive(sg, dg) {
        if (!sg || !dg) return;
        for (var i = 1; i <= sg.numProperties; i++) {
            var sp = sg.property(i);
            var dp = null;
            try { dp = dg.property(sp.matchName); } catch (e) {}
            if (!dp) continue;
            var isLeaf = true;
            try { isLeaf = (sp.propertyType === PropertyType.PROPERTY); } catch (e2) { isLeaf = true; }
            if (isLeaf) { copyPropValue(sp, dp); }
            else { copyGroupRecursive(sp, dp); }
        }
    }

    // 複製圖層樣式(Layer Styles)。目標沒有的樣式會先 addProperty 啟用,再複製參數。
    // 回傳複製的樣式數。
    function copyLayerStyles(srcLayer, dstLayer) {
        var ss, ds;
        try { ss = srcLayer.property("ADBE Layer Styles"); } catch (e) { return 0; }
        if (!ss || ss.numProperties === 0) return 0;
        try { ds = dstLayer.property("ADBE Layer Styles"); } catch (e) { return 0; }
        if (!ds) return 0;
        var count = 0;
        for (var i = 1; i <= ss.numProperties; i++) {
            var sp = ss.property(i);
            // 略過「混合選項」群組本身(它不是可加的樣式)
            if (sp.matchName === "ADBE Blend Options Group") continue;
            var dp = null;
            try { dp = ds.property(sp.matchName); } catch (e) {}
            if (!dp) { try { ds.addProperty(sp.matchName); dp = ds.property(sp.matchName); } catch (eA) { dp = null; } }
            if (!dp) continue;
            try { dp.enabled = sp.enabled; } catch (eE) {}
            copyGroupRecursive(sp, dp);
            count++;
        }
        return count;
    }

    // 同源套效果:以「選取的樣板圖層」為準,把它身上的效果 + 圖層樣式套到全專案中
    // 「來源(source)相同」的所有圖層(不是同名,是同一個來源 comp/素材)。
    // 目標已有同名效果就更新其參數,否則新增,避免重複堆疊。
    function applyEffectsToSameSource() {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers;
        if (sel.length !== 1) { alert("只選「一個」已加好效果的樣板圖層,再按。"); return; }
        var tmpl = sel[0];
        var src = tmpl.source;
        if (!src) { alert("樣板圖層沒有來源素材,無法判斷同源。"); return; }
        var tFx = tmpl.property("ADBE Effect Parade");
        var nFx = (tFx ? tFx.numProperties : 0);
        var tLS = null, nLS = 0;
        try { tLS = tmpl.property("ADBE Layer Styles"); nLS = (tLS ? tLS.numProperties : 0); } catch (e) {}
        // 圖層樣式群組至少含一個「混合選項」,所以 numProperties>1 才算真的有樣式
        var hasStyles = (nLS > 1);
        if (nFx === 0 && !hasStyles) { alert("樣板圖層上沒有效果,也沒有圖層樣式。"); return; }

        app.beginUndoGroup("同源套效果/樣式");
        var layers = 0, comps = 0, styleCopies = 0;
        try {
            for (var ci = 1; ci <= app.project.numItems; ci++) {
                var it = app.project.item(ci);
                if (!(it instanceof CompItem)) continue;
                var touched = false;
                for (var li = 1; li <= it.numLayers; li++) {
                    var L = it.layer(li);
                    if (L === tmpl) continue;
                    if (L.source !== src) continue;          // 關鍵:依來源比對,非名稱
                    // 1) 效果
                    var dFx = L.property("ADBE Effect Parade");
                    if (dFx && nFx > 0) {
                        for (var fi = 1; fi <= nFx; fi++) {
                            var se = tFx.property(fi);
                            // 目標已有同名效果就重用(更新),否則新增
                            var de = null;
                            for (var ei = 1; ei <= dFx.numProperties; ei++) {
                                if (dFx.property(ei).name === se.name) { de = dFx.property(ei); break; }
                            }
                            if (!de) { try { de = dFx.addProperty(se.matchName); } catch (eA) { de = null; } }
                            if (!de) continue;
                            try { de.name = se.name; } catch (eN) {}
                            try { de.enabled = se.enabled; } catch (eE) {}
                            for (var pi = 1; pi <= se.numProperties; pi++) {
                                var sp = se.property(pi);
                                var dp = null;
                                try { dp = de.property(sp.matchName); } catch (eP) {}
                                if (!dp) { try { dp = de.property(pi); } catch (eP2) {} }
                                copyPropValue(sp, dp);
                            }
                        }
                    }
                    // 2) 圖層樣式
                    if (hasStyles) { styleCopies += copyLayerStyles(tmpl, L); }
                    layers++; touched = true;
                }
                if (touched) comps++;
            }
        } finally { app.endUndoGroup(); }
        showStatus("已套到同源(來源:" + src.name + ")的 " + layers + " 個圖層、跨 " + comps +
            " 個合成。效果 " + nFx + " 個" + (hasStyles ? "、圖層樣式已複製" : "") + "。樣板層本身不動。");
    }

    // ================= UI =================

    function buildUI(thisObj) {
        var pal = (thisObj instanceof Panel) ? thisObj
                : new Window("palette", "分鏡工具 v1.0", undefined, { resizeable: true });
        pal.orientation = "column";
        pal.alignChildren = ["fill", "top"];
        pal.spacing = 6; pal.margins = 8;

        // 分頁:每次只顯示一頁,面板高度大幅變矮(橫向擺放友善)
        var tabs = pal.add("tabbedpanel");
        tabs.alignChildren = ["fill", "top"];
        tabs.preferredSize.height = 150;

        function section(title) {
            var t = tabs.add("tab", undefined, title);
            t.orientation = "column";
            t.alignChildren = ["fill", "top"];
            t.spacing = 4; t.margins = 10;
            return t;
        }

        // ── 運鏡 ──
        var secCam = section("運鏡");
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
        var rowCam3 = secCam.add("group");
        rowCam3.add("statictext", undefined, "進階:").preferredSize.width = 56;
        var bShake = rowCam3.add("button", undefined, "抖動"); bShake.preferredSize.width = 56;
        var bOver  = rowCam3.add("button", undefined, "Overshoot"); bOver.preferredSize.width = 90;
        bShake.helpTip = "在播放頭起 1 秒內打抖動 key(±8px),適合強調鏡頭。";
        bOver.helpTip  = "把現有 Position+Scale key 換成帶彈跳的強力緩動。";
        bShake.onClick = function () { camShake(8, 0.08, 1.0); };
        bOver.onClick  = function () { applyOvershoot(); };
        var rowCam4 = secCam.add("group");
        rowCam4.add("statictext", undefined, "軸心:").preferredSize.width = 56;
        var bAnchorC = rowCam4.add("button", undefined, "置中到合成中央"); bAnchorC.preferredSize.width = 130;
        bAnchorC.helpTip = "把選取圖層的軸心移到畫面正中央,內容不位移。推拉/旋轉會以中心為基準。請在加運鏡 key 之前做。";
        bAnchorC.onClick = function () { anchorToCompCenter(); };

        // ── 切鏡 ──
        var secCut = section("切鏡");
        secCut.add("statictext", undefined, "選整疊圖層→在切點分成兩鏡;新整疊集中排上方(不交錯)。標記來源:");
        var rowCutSrc = secCut.add("group");
        var radComp  = rowCutSrc.add("radiobutton", undefined, "合成標記");
        var radAudio = rowCutSrc.add("radiobutton", undefined, "音檔圖層 marker");
        radComp.value = true;
        var rowMark = secCut.add("group");
        var bMark = rowMark.add("button", undefined, "下標記(目前時間)"); bMark.preferredSize.width = 130;
        bMark.onClick = function () { addMarkerNow(radAudio.value ? "audio" : "comp"); };
        rowMark.add("statictext", undefined, "← 不怕中文輸入法吃掉 *");
        var rowCut = secCut.add("group");
        var bCutHead = rowCut.add("button", undefined, "切在播放頭");   bCutHead.preferredSize.width = 100;
        var bCutMark = rowCut.add("button", undefined, "切到下個標記"); bCutMark.preferredSize.width = 100;
        bCutHead.onClick = function () { cutShot(false, radAudio.value ? "audio" : "comp"); };
        bCutMark.onClick = function () { cutShot(true,  radAudio.value ? "audio" : "comp"); };

        // ── 預覽效能 ──
        var secPv = section("預覽效能");
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
        rowWA.add("statictext", undefined, "播放範圍:").preferredSize.width = 56;
        var bWA = rowWA.add("button", undefined, "框到選取鏡"); bWA.preferredSize.width = 100;
        var bWAFull = rowWA.add("button", undefined, "還原全片"); bWAFull.preferredSize.width = 90;
        bWA.onClick = shotToWorkArea;
        bWAFull.onClick = fullWorkArea;
        var rowSolo = secPv.add("group");
        rowSolo.add("statictext", undefined, "Solo:").preferredSize.width = 56;
        var bSolo    = rowSolo.add("button", undefined, "Solo 本鏡");  bSolo.preferredSize.width = 100;
        var bSoloOff = rowSolo.add("button", undefined, "還原 Solo");  bSoloOff.preferredSize.width = 90;
        bSolo.helpTip    = "Solo 選取圖層,其他全部取消 Solo。";
        bSoloOff.helpTip = "還原所有圖層的 Solo 狀態。";
        bSolo.onClick    = function () { soloShot(true); };
        bSoloOff.onClick = function () { soloShot(false); };

        var rowPx = secPv.add("group");
        rowPx.add("statictext", undefined, "代理:").preferredSize.width = 56;
        var bPxMake = rowPx.add("button", undefined, "建靜圖代理"); bPxMake.preferredSize.width = 90;
        var bPxOff  = rowPx.add("button", undefined, "代理關"); bPxOff.preferredSize.width = 56;
        var bPxOn   = rowPx.add("button", undefined, "代理開"); bPxOn.preferredSize.width = 56;
        bPxMake.onClick = makeStillProxy;
        bPxOff.onClick  = function () { toggleProxyUse(false); };
        bPxOn.onClick   = function () { toggleProxyUse(true); };
        secPv.add("statictext", undefined, "代理只給「不會動的大插圖」;會動的(眨眼/嘴)套了會凍結");

        // ── 圖層工具 ──
        var secLay = section("圖層");
        var rowFade = secLay.add("group");
        rowFade.add("statictext", undefined, "淡入淡出:").preferredSize.width = 64;
        var bFadeIn   = rowFade.add("button", undefined, "淡入");   bFadeIn.preferredSize.width = 56;
        var bFadeOut  = rowFade.add("button", undefined, "淡出");   bFadeOut.preferredSize.width = 56;
        var bFadeBoth = rowFade.add("button", undefined, "兩端");   bFadeBoth.preferredSize.width = 56;
        bFadeIn.onClick   = function () { addFade("in",   0.5); };
        bFadeOut.onClick  = function () { addFade("out",  0.5); };
        bFadeBoth.onClick = function () { addFade("both", 0.5); };
        var rowDip = secLay.add("group");
        rowDip.add("statictext", undefined, "過場:").preferredSize.width = 64;
        var bDipB = rowDip.add("button", undefined, "淡黑"); bDipB.preferredSize.width = 50;
        var bDipW = rowDip.add("button", undefined, "淡白"); bDipW.preferredSize.width = 50;
        var bFlash = rowDip.add("button", undefined, "閃白"); bFlash.preferredSize.width = 50;
        bDipB.helpTip = "在播放頭放黑色固態層,opacity 0→100→0。整疊一起淡黑→淡出,不用 precomp。";
        bDipW.helpTip = "同上,改用白色。";
        bFlash.helpTip = "短促的白色閃光(0.3s),用在切換或強調。";
        bDipB.onClick  = function () { dipTransition([0, 0, 0], 1.0); };
        bDipW.onClick  = function () { dipTransition([1, 1, 1], 1.0); };
        bFlash.onClick = function () { dipTransition([1, 1, 1], 0.3); };
        var rowOpNull = secLay.add("group");
        rowOpNull.add("statictext", undefined, "整疊淡:").preferredSize.width = 64;
        var bOpNull = rowOpNull.add("button", undefined, "建淡出控制 Null"); bOpNull.preferredSize.width = 150;
        bOpNull.helpTip = "選整疊→把每層 opacity 接到一顆 Null,改那顆即可控整疊(重疊處會穿幫)。";
        bOpNull.onClick = linkOpacityToNull;
        var rowClr = secLay.add("group");
        rowClr.add("statictext", undefined, "效果:").preferredSize.width = 64;
        var bClr = rowClr.add("button", undefined, "清除選取圖層所有效果"); bClr.preferredSize.width = 180;
        bClr.onClick = clearEffects;
        var rowSame = secLay.add("group");
        rowSame.add("statictext", undefined, "同源:").preferredSize.width = 64;
        var bSame = rowSame.add("button", undefined, "把效果/樣式套到所有同源圖層"); bSame.preferredSize.width = 210;
        bSame.helpTip = "選一個加好效果或圖層樣式的圖層→套到全專案中來源相同的所有圖層(依來源比對,非同名)。含效果與圖層樣式。";
        bSame.onClick = applyEffectsToSameSource;
        var rowNull = secLay.add("group");
        rowNull.add("statictext", undefined, "拆解:").preferredSize.width = 64;
        var bNull = rowNull.add("button", undefined, "建預合成對齊 Null"); bNull.preferredSize.width = 160;
        bNull.helpTip = "選一個預合成圖層→建 Null 複製其變換。再把內層貼到主合成、parent 到此 Null,位置不位移。";
        bNull.onClick = makeCompensationNull;
        secLay.add("statictext", undefined, "拆解預合成:建 Null→內層 parent 到它,即可不位移搬到主合成");

        tabs.selection = secCam;

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
