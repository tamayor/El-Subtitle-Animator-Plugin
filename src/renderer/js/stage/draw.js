// Drawing the preview stage (drawStage).

// idx: which frame to show, null = the last frame (the finished look), -1 = nothing
function drawStage(S, a, idx) {
    const cv = $('stage' + S);
    if (!cv) return;
    if (S === 'U') a = useView(a);

    const ctx = CTX[S];
    const m = (ctx && ctx.model()) || a;

    const imgs = previewImages(a);
    let im = null;
    if (imgs && idx !== -1) {
        const i = idx === null ? imgs.length - 1 : clamp(idx, 0, imgs.length - 1);
        im = imgs[i];
        if (!im.complete || !im.naturalWidth) { im.onload = () => drawStage(S, a, idx); im = null; }
    }

    const bg = state.liveBg.img;
    let tlW = (state.liveBg.width && state.liveBg.height) ? state.liveBg.width : (im ? im.naturalWidth : 1920);
    let tlH = (state.liveBg.width && state.liveBg.height) ? state.liveBg.height : (im ? im.naturalHeight : 1080);
    if (bg && bg.complete && bg.naturalWidth && bg.naturalHeight) {
        const bgAr = bg.naturalWidth / bg.naturalHeight;
        const currentAr = tlW / tlH;
        if (Math.abs(bgAr - currentAr) > 0.05) {
            tlW = bg.naturalWidth;
            tlH = bg.naturalHeight;
        }
    }
    const ar = tlW / tlH;

    let rawPosX = Number(m && m.posX) || 0;
    let rawPosY = Number(m && m.posY) || 0;
    if (Math.abs(rawPosX) <= 1.0 && Math.abs(rawPosY) <= 1.0 && (rawPosX !== 0 || rawPosY !== 0)) {
        rawPosX = Math.round(rawPosX * tlW * 10) / 10;
        rawPosY = Math.round(-rawPosY * tlH * 10) / 10;
    }
    const posX = rawPosX;
    const posY = rawPosY;
    const userScale = Number(m && m.scale) || 1;
    const userRot = Number(m && m.rotation) || 0;
    const zoomVal = (state.stageZoom && state.stageZoom[S]) || 1.0;
    const isZoomOn = !!(state.zoomEnabled && state.zoomEnabled[S]);
    const resetBtn = $('resetPos' + S);
    if (resetBtn) resetBtn.disabled = (Math.abs(posX) < 0.1 && Math.abs(posY) < 0.1 && Math.abs(userScale - 1) < 0.005 && Math.abs(userRot) < 0.1 && Math.abs(zoomVal - 1.0) < 0.01 && !isZoomOn);
    syncXformUI(S, posX, posY, userScale, userRot);

    // Match the stage canvas to the full container width by default, or the user's custom viewer height.
    const stageBox = $('stageBox' + S);
    const customH = (state.stageHeight && state.stageHeight[S]) || (state.stageSize && state.stageSize[S] && state.stageSize[S].h);
    const inResizeMode = !!(state.stageResizeMode && state.stageResizeMode[S]);

    if (stageBox) {
        stageBox.classList.toggle('resize-mode', inResizeMode);
        stageBox.style.width = '100%';
    }
    if ($('stageResize' + S)) $('stageResize' + S).classList.toggle('hidden', !inResizeMode);
    if ($('stageResizeBtn' + S)) $('stageResizeBtn' + S).classList.toggle('on', inResizeMode);
    if ($('stageResizeLbl' + S)) $('stageResizeLbl' + S).textContent = inResizeMode ? 'Done resizing' : 'Resize viewer';
    if ($('stageSizeReset' + S)) $('stageSizeReset' + S).classList.toggle('hidden', !customH);

    cv.style.width = '100%';
    if (customH) {
        const wantH = Math.round(customH) + 'px';
        if (cv.style.height !== wantH) cv.style.height = wantH;
        if (cv.style.aspectRatio !== 'auto') cv.style.aspectRatio = 'auto';
    } else {
        if (cv.style.height !== 'auto') cv.style.height = 'auto';
        const wantAspect = tlW + ' / ' + tlH;
        if (cv.style.aspectRatio !== wantAspect) cv.style.aspectRatio = wantAspect;
    }

    const domRect = cv.getBoundingClientRect();
    const boxAr = (customH && domRect.width > 10 && domRect.height > 10) ? (domRect.width / domRect.height) : ar;
    // Canvas pixels = the viewer's real screen pixels (Retina included), never more than the timeline itself, so the
    // frame is drawn 1:1 instead of being scaled up from a small canvas.
    const dpr = window.devicePixelRatio || 1;
    const cssW = domRect.width > 10 ? domRect.width : 640;
    const cssH = (customH && domRect.height > 10) ? domRect.height : cssW / boxAr;
    const fit = Math.min(1, Math.max(tlW, tlH) / Math.max(cssW * dpr, cssH * dpr));
    let targetW, targetH;
    if (boxAr >= 1) {
        targetW = Math.max(200, Math.round(cssW * dpr * fit));
        targetH = Math.max(100, Math.round(targetW / boxAr));
    } else {
        targetH = Math.max(200, Math.round(cssH * dpr * fit));
        targetW = Math.max(100, Math.round(targetH * boxAr));
    }
    if (cv.width !== targetW || cv.height !== targetH) {
        cv.width = targetW;
        cv.height = targetH;
    }

    const g = cv.getContext('2d');
    let vw = cv.width, vh = cv.height;
    if (Math.abs(boxAr - ar) > 0.005) {
        if (ar > boxAr) {
            vw = cv.width;
            vh = cv.width / ar;
        } else {
            vh = cv.height;
            vw = cv.height * ar;
        }
    }
    const vx = (cv.width - vw) * 0.5;
    const vy = (cv.height - vh) * 0.5;
    cv._viewport = { vx, vy, vw, vh };
    cv._zoom = zoomVal;

    g.save();
    g.beginPath();
    g.rect(0, 0, cv.width, cv.height);
    g.clip();

    // Always clear the whole canvas first so zooming out never leaves smeared copies behind.
    g.clearRect(0, 0, cv.width, cv.height);
    const hasSurround = zoomVal < 1.0 || vx > 0.5 || vy > 0.5;
    if (hasSurround) {
        // Fill any area around the active frame with a blurred, darkened copy of the frame.
        g.fillStyle = '#0b0d0c';
        g.fillRect(0, 0, cv.width, cv.height);
        if (bg && bg.complete && bg.naturalWidth) {
            g.save();
            g.filter = 'blur(' + Math.round(18 * (Math.min(cv.width, cv.height) / 360)) + 'px) brightness(0.32) saturate(0.7)';
            const over = 40;   // overdraw so the blur doesn't fade to transparent at the edges
            g.drawImage(bg, -over, -over, cv.width + over * 2, cv.height + over * 2);
            g.restore();
        }
    }

    if (zoomVal !== 1.0) {
        g.translate(cv.width * 0.5, cv.height * 0.5);
        g.scale(zoomVal, zoomVal);
        g.translate(-cv.width * 0.5, -cv.height * 0.5);
    }

    // 1. Live timeline background frame filling the timeline-aspect stage
    if (bg && bg.complete && bg.naturalWidth) {
        g.drawImage(bg, vx, vy, vw, vh);
    } else {
        g.fillStyle = '#16161a';
        g.fillRect(vx, vy, vw, vh);
    }
    if (hasSurround) {
        // Outline the real frame so its edges read clearly against the dimmed surround.
        g.save();
        g.strokeStyle = 'rgba(239, 245, 240, 0.35)';
        g.lineWidth = 1 / zoomVal;
        g.strokeRect(vx, vy, vw, vh);
        g.restore();
    }

    // Presets with detected Text+ / template nodes show the preset's real rendered animation (captured from Fusion)
    // looping over the video frame. One text: the usual move / resize / rotate handles. Several texts: one box each.
    const boxMode = !!(window.SABoxes && SABoxes.active(a));
    const multiBox = boxMode && SABoxes.nodesOf(a).length > 1;
    let previewSingle = false;
    let paintedSingle = false;
    const gxy = { zoom: zoomVal, rot: userRot, scale: userScale, posX, posY, tlW, tlH };
    const activeSubText = (($('subText') && $('subText').value.trim()) || (state.live && state.live.subtitle && state.live.subtitle.text) || '');
    // Captured Fusion frames are the preset exactly as built (nodes + keyframes untouched), so they are used whenever
    // they exist. With a live subtitle, Fusion re-renders the preset with that text in the background and the stage
    // swaps to those frames when they are ready; the approximation below is only a last resort when no frames exist.
    // Edited designs are rendered by Fusion too; until those frames arrive the last real render keeps playing
    // (with a Rendering overlay) instead of switching to a hand-drawn imitation, which is what made it glitch.
    const canUseCaptured = true;
    if (S === 'U') ensureUsePreview(a); else ensureRealPreview(a, m);
    syncStageOverlay(S, stageRendering(S, a));

    if (multiBox) {
        // Several Text+: the whole group gets the same move / resize / rotate handles as any other preset (drawn
        // below); the numbered boxes only pick which Text+ the Text Design panel edits.
        paintedSingle = canUseCaptured && SABoxes.paint(g, a, m, { vx, vy, vw, vh }, gxy, idx);
        SABoxes.draw(S, a, m, cv, { vx, vy, vw, vh }, gxy, paintedSingle);
        previewSingle = true;      // never hand-draw the first Text+ on its own over the group
    } else if (window.SABoxes) SABoxes.hideLayer(S);
    // Plays the rendered Fusion frames when they exist and no live subtitle or design override is active; otherwise the real text overlay stands in.
    if (!multiBox && canUseCaptured && window.SABoxes) {
        paintedSingle = SABoxes.paint(g, a, m, { vx, vy, vw, vh }, gxy, idx);
        previewSingle = paintedSingle;
    }
    for (const id of ['prev', 'loop']) { const e = $(id + S); if (e) e.style.display = 'none'; }

    // 2. Animated Text+ overlay with (posX, posY, userScale, userRot) and full Text & Shading Elements (1..8)
    const dx = (posX / tlW) * vw;
    const dy = -(posY / tlH) * vh;
    const rotRad = (userRot * Math.PI) / 180;
    const cx = vx + vw * 0.5 + dx;
    const cy = vy + vh * 0.5 + dy;

    // Resolve Text+ layout position: locate text inside layer based on template node or custom box center
    let layoutCx = 0.5;
    let layoutCy = 0.5;
    let layoutScale = 1.0;
    if (a && Array.isArray(a.nodes) && a.nodes.length) {
        const primaryNode = a.nodes[0];
        if (typeof primaryNode.cx === 'number') layoutCx = primaryNode.cx;
        if (typeof primaryNode.cy === 'number') layoutCy = primaryNode.cy;
        const b = (m && m.boxes && m.boxes[primaryNode.id]) || (a.boxes && a.boxes[primaryNode.id]);
        if (b) {
            if (typeof b.cx === 'number') layoutCx = b.cx;
            if (typeof b.cy === 'number') layoutCy = b.cy;
            if (typeof b.scale === 'number' && b.scale > 0) layoutScale = b.scale;
        }
    } else if (m && m.boxes) {
        const firstKey = Object.keys(m.boxes)[0];
        if (firstKey && m.boxes[firstKey]) {
            const b = m.boxes[firstKey];
            if (typeof b.cx === 'number') layoutCx = b.cx;
            if (typeof b.cy === 'number') layoutCy = b.cy;
            if (typeof b.scale === 'number' && b.scale > 0) layoutScale = b.scale;
        }
    } else if (a && a.boxes) {
        const firstKey = Object.keys(a.boxes)[0];
        if (firstKey && a.boxes[firstKey]) {
            const b = a.boxes[firstKey];
            if (typeof b.cx === 'number') layoutCx = b.cx;
            if (typeof b.cy === 'number') layoutCy = b.cy;
            if (typeof b.scale === 'number' && b.scale > 0) layoutScale = b.scale;
        }
    }
    const layoutOx = (layoutCx - 0.5) * vw;
    const layoutOy = -(layoutCy - 0.5) * vh;

    const td = cloneTextDesign((m && m.textDesign) || (a && a.textDesign));
    if (idx !== -1 && !previewSingle) {
        // Timeline frame clipping: text does not render outside the active timeline frame
        g.save();
        g.beginPath();
        g.rect(vx, vy, vw, vh);
        g.clip();

        const useCapturedPreview = !!(im && canUseCaptured && !(window.SAThumbs && SAThumbs.isBlank(a)));
        if (useCapturedPreview) {
            const oc = keyedImage(im);
            const imgW = (oc && oc.width) || (im && im.naturalWidth) || 0;
            const imgH = (oc && oc.height) || (im && im.naturalHeight) || 0;
            let drawW = vw;
            let drawH = vh;
            if (imgW > 0 && imgH > 0) {
                const imgAr = imgW / imgH;
                const vpAr = vw / vh;
                if (Math.abs(imgAr - vpAr) > 0.005) {
                    if (imgAr < vpAr) {
                        drawH = vh;
                        drawW = vh * imgAr;
                    } else {
                        drawW = vw;
                        drawH = vw / imgAr;
                    }
                }
            }
            g.save();
            g.translate(cx, cy);
            if (rotRad) g.rotate(rotRad);
            if (userScale !== 1) g.scale(userScale, userScale);
            // Clip strictly to transform box boundary
            g.beginPath();
            g.rect(-vw / 2, -vh / 2, vw, vh);
            g.clip();
            g.drawImage(oc, -drawW / 2 + layoutOx, -drawH / 2 + layoutOy, drawW, drawH);
            g.restore();
        } else {
            const defaultTxt = (a && Array.isArray(a.nodes) && a.nodes.length && a.nodes[0].defaultText) || '';
            const txt = activeSubText || defaultTxt || 'Sample text';
            const lines = wrapToLines(String(txt));
            const _css = saStyleToCss(td.style === '' ? 'Regular' : (td.style || 'Bold'));
            const weight = _css.weight;
            const isItalic = _css.italic;

            const spec = td.animSpec || (a && a.textDesign && a.textDesign.animSpec) || null;
            const frameRepeat = Math.max(1, Number(spec && spec.frameRepeat) || (td.wiggle ? 4 : 1));
            const isPlaying = (idx !== null && idx >= 0);
            const qFrame = isPlaying ? Math.floor(idx / frameRepeat) * frameRepeat : null;
            const stepIdx = isPlaying ? Math.floor(idx / frameRepeat) : 0;

            const presetName = String((a && a.name) || (m && m.name) || '').toLowerCase();
            const isSlideDown = presetName.includes('slide down') || (spec && spec.follower && Number(spec.follower.slideY) > 0.005);
            const isSlideIn = presetName.includes('slide in') || (spec && spec.follower && Number(spec.follower.slideY) < -0.005);
            const isSlide = isSlideDown || isSlideIn;
            const isTyping = presetName.includes('typing') || presetName.includes('typewriter');
            const hasFollower = !!(spec && spec.follower) || isSlide || isTyping;

            const baseSize = Number(td.size) || 0.12;
            const animSize = (isPlaying && spec && spec.sizeKeys) ? evalSpline(spec.sizeKeys, qFrame, baseSize) : baseSize;
            let popScale = baseSize > 0.001 ? (animSize / baseSize) : 1;
            if (isPlaying && (!spec || !spec.sizeKeys) && !hasFollower) popScale *= introPop(idx);
            const animOpacity = (isPlaying && spec && spec.opacityKeys) ? clamp(evalSpline(spec.opacityKeys, qFrame, 1), 0, 1) : (isPlaying ? clamp(idx / 4, 0, 1) : 1);
            const animTrack = (isPlaying && spec && spec.trackingKeys) ? evalSpline(spec.trackingKeys, qFrame, Number(td.tracking) || 1) : (Number(td.tracking) || 1);
            const erodeVal = (isPlaying && spec && spec.erode) ? evalSpline(spec.erode, qFrame, 0) : 0;

            const baseScale = clamp(baseSize * 0.62, 0.015, 0.65);
            const fontPx = Math.max(12, Math.round(vw * baseScale));
            g.font = (isItalic ? 'italic ' : '') + weight + ' ' + fontPx + 'px "' + (td.font || 'Poppins') + '", -apple-system, sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            try {
                g.letterSpacing = Math.round((animTrack - 1) * fontPx * 0.22) + 'px';
            } catch (e) { /* ignore if unsupported */ }

            let jx = 0, jy = 0, animRot = 0;
            if (isPlaying && spec && spec.angleKeys) {
                animRot += (evalSpline(spec.angleKeys, qFrame, 0) * Math.PI) / 180;
            }

            const hasWiggle = !!(spec && (spec.displace || spec.perturb)) || !!td.wiggle || presetName.includes('wiggle');
            if (isPlaying && hasWiggle) {
                jx = Math.sin(stepIdx * 1.7 + 0.5) * fontPx * 0.025;
                jy = Math.cos(stepIdx * 2.1 + 0.3) * fontPx * 0.025;
                animRot += Math.sin(stepIdx * 1.3) * 0.005;
            }

            const hasBoil = hasWiggle;
            if (hasBoil) {
                const turbEl = $('saTurb' + S);
                const dispEl = $('saDisp' + S);
                if (turbEl) turbEl.setAttribute('seed', String(((stepIdx * 13) % 89) + 2));
                if (dispEl) {
                    const refr = Number(spec && spec.displace && spec.displace.refraction) || 1;
                    dispEl.setAttribute('scale', Math.max(1.0, Math.min(2.5, fontPx * 0.018 * refr)).toFixed(2));
                }
            }

            const lineWidths = lines.map(l => g.measureText(l).width);
            const maxLineW = Math.max(24, ...lineWidths);
            const lineH = fontPx * clamp(Number(td.lineSpacing) || 1, 0.4, 2.5) * 1.16;
            const totalH = lineH * lines.length;

            g.save();
            g.translate(cx, cy);
            if (rotRad || animRot) g.rotate(rotRad + animRot);
            if (userScale !== 1) g.scale(userScale, userScale);
            // Clip strictly to transform box boundary
            g.beginPath();
            g.rect(-vw / 2, -vh / 2, vw, vh);
            g.clip();
            g.translate(layoutOx + jx, layoutOy + jy);
            if (layoutScale !== 1) g.scale(layoutScale, layoutScale);
            const erodeScaleX = erodeVal < 0 ? Math.max(0.84, 1 + erodeVal * 6.5) : 1;
            const erodeScaleY = erodeVal < 0 ? Math.max(0.88, 1 + erodeVal * 3.5) : 1;
            const sxTotal = popScale * erodeScaleX;
            const syTotal = popScale * erodeScaleY;
            if (sxTotal !== 1 || syTotal !== 1) g.scale(sxTotal, syTotal);

            // Compute global word index map so timing is sequential across multiple lines
            let totalWords = 0;
            const lineWordInfo = lines.map(line => {
                const toks = String(line).split(/(\s+)/);
                return toks.map(tok => {
                    const isWord = !!tok.trim();
                    const wIdx = isWord ? totalWords++ : -1;
                    return { tok, isWord, wIdx };
                });
            });

            const rawDelay = Number(spec && spec.follower && spec.follower.delay) || 0.5;
            const wordDelayFrames = isTyping ? 4 : Math.max(4, Math.min(12, Math.round(rawDelay <= 2 ? rawDelay * 10 : rawDelay)));
            const currentF = isPlaying ? ((qFrame !== null && qFrame !== undefined) ? qFrame : idx) : 999;

            // Render Shading Elements 8 down to 1 (Priority order: higher elements sit behind Element 1)
            const drawRRect = (x, y, w, h, r) => {
                const rad = Math.max(0, Math.min(r, Math.min(w, h) / 2));
                g.beginPath();
                if (typeof g.roundRect === 'function') {
                    g.roundRect(x, y, w, h, rad);
                } else {
                    g.rect(x, y, w, h);
                }
            };

            const pt = (spec && spec.perturb) || null;
            const drawGlyphLine = (line, li, ox, oy, isStroke) => {
                const ly = (li - (lines.length - 1) / 2) * lineH + oy;
                const lineToks = lineWordInfo[li] || [];

                if (!isPlaying || !hasFollower) {
                    let wx = ox, wy = ly;
                    if (isPlaying && pt) {
                        const seed = stepIdx * 2.3 + li * 1.7;
                        wx += Math.cos(seed) * vw * (Number(pt.xScale) || 0) * 0.18;
                        wy += Math.sin(seed) * vh * (Number(pt.yScale) ?? 0.02) * 0.18;
                    }
                    if (isStroke) g.strokeText(line, wx, wy); else g.fillText(line, wx, wy);
                    return;
                }

                const fullW = g.measureText(line).width;
                let curX = ox - fullW * 0.5;

                lineToks.forEach(({ tok, isWord, wIdx }) => {
                    const tw = g.measureText(tok).width;
                    if (!isWord) {
                        curX += tw;
                        return;
                    }

                    const wordStart = wIdx * wordDelayFrames;
                    const wordAge = currentF - wordStart;

                    if (wordAge >= 0) {
                        let easeOut = 1;
                        if (spec && spec.follower && spec.follower.pathSpline) {
                            easeOut = clamp(evalSpline(spec.follower.pathSpline, wordAge, 1), 0, 1);
                        } else {
                            const animDur = isSlide ? 16 : 4;
                            const progress = clamp(wordAge / animDur, 0, 1);
                            easeOut = 1 - Math.pow(1 - progress, 3);
                        }

                        let dySlide = 0;
                        let dxSlide = 0;
                        if (spec && spec.follower && Math.abs(spec.follower.slideY) > 0.001) {
                            const targetDy = clamp(-spec.follower.slideY * vh * 0.8, -fontPx * 1.1, fontPx * 1.1);
                            dySlide = (1 - easeOut) * targetDy;
                        } else if (isSlideDown) {
                            dySlide = -(1 - easeOut) * (fontPx * 0.75);
                        } else if (isSlideIn) {
                            dySlide = (1 - easeOut) * (fontPx * 0.85);
                        }

                        if (spec && spec.follower && Math.abs(spec.follower.slideX) > 0.001) {
                            const targetDx = clamp(spec.follower.slideX * vw * 0.8, -fontPx * 1.2, fontPx * 1.2);
                            dxSlide = (1 - easeOut) * targetDx;
                        }

                        let wordAlpha = 1;
                        if (spec && spec.follower && spec.follower.opacityKeys) {
                            wordAlpha = clamp(evalSpline(spec.follower.opacityKeys, wordAge, 1), 0, 1);
                        } else {
                            wordAlpha = clamp(wordAge / (isSlide ? 6 : 2), 0, 1);
                        }

                        let wordScale = 1;
                        if (spec && spec.follower && spec.follower.sizeKeys) {
                            wordScale = clamp(evalSpline(spec.follower.sizeKeys, wordAge, 1), 0.7, 1.3);
                        } else if (isTyping) {
                            wordScale = wordAge < 4 ? 0.93 + 0.07 * easeOut : 1.0;
                        } else if (isSlide) {
                            wordScale = wordAge < 16 ? 0.97 + 0.03 * easeOut : 1.0;
                        }

                        let wordRot = 0;
                        if (spec && spec.follower && spec.follower.rotKeys) {
                            wordRot = (evalSpline(spec.follower.rotKeys, wordAge, 0) * Math.PI) / 180;
                        }

                        let glitchDx = 0;
                        if (isSlideIn && wordAge < 8) {
                            glitchDx = (Math.sin(wordAge * 12.3) > 0.4 ? 2 : -1.5) * (1 - wordAge / 8);
                        }

                        g.save();
                        g.translate(curX + tw * 0.5 + dxSlide + glitchDx, ly + dySlide);
                        if (wordRot) g.rotate(wordRot);
                        if (wordScale !== 1) g.scale(wordScale, wordScale);
                        if (wordAlpha < 1) g.globalAlpha = (g.globalAlpha || 1) * wordAlpha;

                        if (isStroke) g.strokeText(tok, 0, 0); else g.fillText(tok, 0, 0);
                        g.restore();
                    }
                    curX += tw;
                });
            };

            for (let ei = 8; ei >= 1; ei--) {
                const el = td.elements[ei - 1];
                if (!el || !el.enabled || el.alpha === 0) continue;
                const op = clamp(Number(el.opacity ?? 1) * animOpacity, 0, 1);
                if (op <= 0.005) continue;

                g.save();
                g.globalAlpha = op;
                const ox = (Number(el.offsetX) || 0) * fontPx * 0.85;
                const oy = -(Number(el.offsetY) || 0) * fontPx * 0.85;
                const soft = Number(el.softness) || 0;
                const filters = [];
                if (soft > 0) {
                    filters.push('blur(' + Math.min(24, soft * fontPx * 0.06).toFixed(1) + 'px)');
                }
                if (hasBoil) {
                    filters.push('url(#saBoil' + S + ')');
                }
                if (filters.length) {
                    g.filter = filters.join(' ');
                }

                const shape = Number(el.shape) || 0;
                const elType = Number(el.type) || 0;
                let col = el.color || '#ffffff';
                if (elType === 2) {
                    const angleRad = ((Number(el.mappingAngle) || 0) * Math.PI) / 180;
                    const hw = (maxLineW / 2) * (Number(el.mappingSize) || 1);
                    const dx = Math.cos(angleRad) * hw;
                    const dy = Math.sin(angleRad) * hw;
                    const grad = g.createLinearGradient(-dx, -dy, dx, dy);
                    grad.addColorStop(0, el.color || '#ffffff');
                    grad.addColorStop(1, el.color2 || '#f07b8e');
                    col = grad;
                }

                if (shape === 2 || shape === 3) {
                    // Border Fill (2) or Border Outline (3)
                    const padX = fontPx * (0.24 + (Number(el.extendH) || 0) * 1.4);
                    const padY = fontPx * (0.14 + (Number(el.extendV) || 0) * 1.1);
                    const bw = Math.max(8, maxLineW + padX * 2);
                    const bh = Math.max(8, totalH + padY * 2);
                    const rad = clamp(Number(el.round) || 0, 0, 1) * Math.min(bw, bh) * 0.5;
                    drawRRect(-bw / 2 + ox, -bh / 2 + oy, bw, bh, rad);
                    if (shape === 2) {
                        g.fillStyle = col;
                        g.fill();
                    } else {
                        g.strokeStyle = col;
                        g.lineWidth = Math.max(1.5, (Number(el.thickness) || 0.02) * fontPx * 4);
                        g.stroke();
                    }
                } else if (shape === 1) {
                    // Text Outline (1)
                    g.strokeStyle = col;
                    g.lineJoin = 'round';
                    g.lineWidth = Math.max(1.5, (Number(el.thickness) || 0.02) * fontPx * 5);
                    lines.forEach((line, li) => drawGlyphLine(line, li, ox, oy, true));
                } else {
                    // Text Fill (0)
                    g.fillStyle = col;
                    lines.forEach((line, li) => drawGlyphLine(line, li, ox, oy, false));
                }
                g.restore();
            }
            g.restore();
        }
        g.restore(); // end timeline resolution clip
    }

    // Center guides while moving (drawn in the zoomed frame space)
    const isDragging = state.stageDrag && state.stageDrag.S === S;
    if (isDragging && state.stageDrag.mode === 'move') {
        g.strokeStyle = 'rgba(140, 207, 142, 0.85)';
        g.lineWidth = 1 / zoomVal;
        if (Math.abs(posX) < 2) { g.beginPath(); g.moveTo(vx + vw / 2, vy); g.lineTo(vx + vw / 2, vy + vh); g.stroke(); }
        if (Math.abs(posY) < 2) { g.beginPath(); g.moveTo(vx, vy + vh / 2); g.lineTo(vx + vw, vy + vh / 2); g.stroke(); }
    }
    // Leave the zoomed space: the gizmo is drawn and hit-tested in plain canvas pixels,
    // with handle sizes in screen pixels so they stay grabbable at any panel size or zoom.
    g.restore();

    const rectW = cv.getBoundingClientRect().width || cv.width;
    const k = cv.width / Math.max(1, rectW);                 // canvas px per screen px
    const toScreen = (x, y) => ({ x: (x - cv.width * 0.5) * zoomVal + cv.width * 0.5, y: (y - cv.height * 0.5) * zoomVal + cv.height * 0.5 });
    const sc = toScreen(cx, cy);
    const hw = (vw * 0.5) * userScale * zoomVal;
    const hh = (vh * 0.5) * userScale * zoomVal;
    const cos = Math.cos(rotRad), sin = Math.sin(rotRad);
    const toCanvas = (lx, ly) => ({ x: sc.x + lx * cos - ly * sin, y: sc.y + lx * sin + ly * cos });
    // Rotation stem points up from center anchor point to rotation handle (matching DaVinci Resolve)
    const rotArmLen = Math.max(30 * k, Math.min(hh * 0.42, 100 * k));
    const rotHandle = toCanvas(0, -rotArmLen);
    const rawCorners = [
        toCanvas(-hw, -hh), // 0: Top-Left
        toCanvas(hw, -hh),  // 1: Top-Right
        toCanvas(hw, hh),   // 2: Bottom-Right
        toCanvas(-hw, hh)   // 3: Bottom-Left
    ];
    const rawEdges = [
        toCanvas(0, -hh),   // 0: Top-Center
        toCanvas(hw, 0),    // 1: Right-Center
        toCanvas(0, hh),    // 2: Bottom-Center
        toCanvas(-hw, 0)    // 3: Left-Center
    ];
    cv._gizmo = {
        cx: sc.x,
        cy: sc.y,
        hw,
        hh,
        rotRad,
        rotHandle,
        corners: rawCorners,
        rawCorners,
        edges: rawEdges,
        rawEdges,
        center: sc,
        k
    };

    // 3. DaVinci Resolve authentic layer transform gizmo
    // Solid white bounding box, 4 corners, 4 edge midpoints, center anchor point, and rotation stem & handle
    const isDraggingGizmo = isDragging && state.stageDrag;
    const mode = isDraggingGizmo ? state.stageDrag.mode : null;
    const hov = (!isDraggingGizmo && state.stageHoverHit && state.stageHoverHit.S === S) ? state.stageHoverHit : null;

    g.save();
    // Bounding box: solid white
    g.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    g.lineWidth = 1.35 * k;
    g.beginPath();
    rawCorners.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    g.stroke();

    // Rotation stem: solid white line from center anchor point up to rotation handle
    g.beginPath();
    g.moveTo(sc.x, sc.y);
    g.lineTo(rotHandle.x, rotHandle.y);
    g.stroke();

    // DaVinci Resolve circular control handles: white fill with royal blue border
    const drawHandle = (pt, isActive, isHov, isCenter) => {
        const hr = (isActive ? 5.8 : (isHov ? 5.2 : 4.4)) * k;
        g.beginPath();
        g.arc(pt.x, pt.y, hr, 0, Math.PI * 2);
        g.fillStyle = '#ffffff';
        g.fill();
        g.strokeStyle = isActive ? '#5b95ff' : '#2b62c9';
        g.lineWidth = (isActive ? 2.0 : 1.4) * k;
        g.stroke();
        if (isCenter) {
            g.beginPath();
            g.arc(pt.x, pt.y, 1.3 * k, 0, Math.PI * 2);
            g.fillStyle = isActive ? '#5b95ff' : '#2b62c9';
            g.fill();
        }
    };

    // 4 Corner resize handles
    rawCorners.forEach((c, i) => {
        const cActive = (mode === 'scale' && state.stageDrag.corner === i);
        const cHov = (hov && hov.mode === 'scale' && hov.corner === i);
        drawHandle(c, cActive, cHov, false);
    });

    // 4 Edge midpoint resize handles
    rawEdges.forEach((ePt, i) => {
        const eActive = (mode === 'scale-edge' && state.stageDrag.edge === i);
        const eHov = (hov && hov.mode === 'scale-edge' && hov.edge === i);
        drawHandle(ePt, eActive, eHov, false);
    });

    // Center Anchor Point handle
    const centerActive = (mode === 'move' && state.stageDrag && state.stageDrag.isCenter);
    const centerHov = (hov && hov.mode === 'move' && hov.isCenter);
    drawHandle(sc, centerActive, centerHov, true);

    // Rotation handle
    const rotActive = (mode === 'rotate');
    const rotHov = (hov && hov.mode === 'rotate');
    drawHandle(rotHandle, rotActive, rotHov, false);

    g.restore();

    // Border around the active video frame
    g.strokeStyle = '#29302b';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, cv.width - 1, cv.height - 1);

    const msg = $('stageMsg' + S);
    if (msg) {
        const metaParts = [];
        if (state.liveBg.width && state.liveBg.height) metaParts.push(state.liveBg.width + '×' + state.liveBg.height);
        if (Math.abs(zoomVal - 1.0) >= 0.01) metaParts.push('Preview Zoom ' + Math.round(zoomVal * 100) + '%');
        if (posX !== 0 || posY !== 0) metaParts.push('Pos X: ' + posX.toFixed(1) + ' px, Y: ' + posY.toFixed(1) + ' px');
        if (Math.abs(userScale - 1) >= 0.005) metaParts.push('Zoom ' + userScale.toFixed(3));
        if (Math.abs(userRot) >= 0.1) metaParts.push('Rot ' + userRot.toFixed(1) + '°');
        const prefix = metaParts.length ? metaParts.join(' · ') + ' — ' : '';
        msg.textContent = prefix + (multiBox
            ? (paintedSingle ? 'Drag to move all the text, handles to resize, top arm to rotate. Click a box to edit that Text+ in Text Design.' : 'No animation preview yet. Press Make preview on this preset in the list.')
            : 'Drag box or center to move, handles to resize, top arm to rotate.');
    }
}
