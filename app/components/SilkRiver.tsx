/* eslint-disable */
// @ts-nocheck -- vendored WebGL component; only this header, "use client" and the props type were added
"use client";

import { useEffect, useRef } from "react"

/**
 * Silk River: a slow, self-flowing pastel paint gradient (WebGL fluid sim).
 * No cursor interaction. Pauses when offscreen, shows one settled still frame for
 * prefers-reduced-motion, and falls back to a soft CSS gradient without WebGL.
 * Give it a size through `style` or `className` (it fills its box).
 *
 * <SilkRiver style={{ position: "absolute", inset: 0 }} />
 */
const DEFAULT_IMAGE = "https://framerusercontent.com/images/zNonUd1Ipp6Ye9CbuEVJEv2X10.png"

const DEFAULTS = {
    base: "#FCFAF6", soft: "#EAF2FA", main: "#CFE3F6", accent: "#F7E1CC", deep: "#B7D5F0",
    saturation: 100, vibrancy: 0,
    flowSpeed: 1,
    fade: false, fadeColor: "#F4F4FF", fadeHeight: 160,
    stillOnPhone: false,
}


export default function SilkRiver(incoming: any) {
    const props = { ...DEFAULTS, ...incoming }
    const { base, soft, main, accent, image, fade, fadeColor, fadeHeight, stillOnPhone, style, className } = props
    const wrapRef = useRef(null)
    const canvasRef = useRef(null)
    const settings = useRef(props)
    settings.current = props
    const imageSrc = (image && (image.src || (typeof image === "string" ? image : ""))) || DEFAULT_IMAGE

    const staticBackground =
        `radial-gradient(60% 70% at 25% 35%, ${main} 0%, transparent 70%),` +
        `radial-gradient(45% 55% at 75% 60%, ${accent} 0%, transparent 70%),` +
        `radial-gradient(50% 60% at 60% 20%, ${soft} 0%, transparent 70%), ${base}`

    useEffect(() => {
        const canvas = canvasRef.current
        const wrap = wrapRef.current
        if (!canvas || !wrap) return
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        const isPhone = window.innerWidth < 810
        const stillOnly = reduceMotion || (settings.current.stillOnPhone && isPhone)
        const params = { alpha: false, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false }
        let gl = canvas.getContext("webgl2", params)
        const isGL2 = !!gl
        if (!gl) gl = canvas.getContext("webgl", params)
        if (!gl) { canvas.style.display = "none"; return }

        let halfType, internal, filter
        if (isGL2) {
            gl.getExtension("EXT_color_buffer_float")
            gl.getExtension("EXT_color_buffer_half_float")
            halfType = gl.HALF_FLOAT; internal = gl.RGBA16F; filter = gl.LINEAR
        } else {
            const hf = gl.getExtension("OES_texture_half_float")
            if (!hf) { canvas.style.display = "none"; return }
            filter = gl.getExtension("OES_texture_half_float_linear") ? gl.LINEAR : gl.NEAREST
            halfType = hf.HALF_FLOAT_OES; internal = gl.RGBA
        }

        const SIM_RES = 64, DYE_RES = isPhone ? 512 : 768, PRESSURE_ITER = 20
        const SHEAR = 0.6, MEANDER = 0.55, PULL = 0.7, SWIRL = 3, VISCOSITY = 0.5
        const SLOPE = [1.0, 0.42], NEW_COLOR_SPEED = 0.06
        // the fluid runs in the artwork's own colors; the display step repaints them in the palette
        const ORIGINAL = { base: [0.970, 0.966, 0.984], soft: [0.843, 0.912, 0.994], accent: [0.880, 0.845, 0.982], main: [0.735, 0.868, 0.992], deep: [0.560, 0.835, 0.990] }

        const vsSrc = `precision highp float;
            attribute vec2 aPos;
            varying vec2 vUv, vL, vR, vT, vB;
            uniform vec2 texel;
            void main () {
                vUv = aPos * 0.5 + 0.5;
                vL = vUv - vec2(texel.x, 0.0); vR = vUv + vec2(texel.x, 0.0);
                vT = vUv + vec2(0.0, texel.y); vB = vUv - vec2(0.0, texel.y);
                gl_Position = vec4(aPos, 0.0, 1.0);
            }`
        const head = `precision highp float; precision highp sampler2D;
            varying vec2 vUv, vL, vR, vT, vB;`
        const paintFn = `
            uniform vec3 pBase, pSoft, pAccent, pMain, pDeep;
            uniform sampler2D uImage; uniform vec2 uCover;
            vec3 artwork (vec2 uv) { return texture2D(uImage, (uv - 0.5) * uCover + 0.5).rgb; }
            float h1 (float n) { return fract(sin(n) * 43758.5453); }
            float n1 (float x) { float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
            vec3 paint (float s) {
                float x = fract(s) * 8.0;
                vec3 c = pBase;
                c = mix(c, pSoft,   smoothstep(1.0, 1.6, x));
                c = mix(c, pAccent, smoothstep(1.8, 2.2, x));
                c = mix(c, pSoft,   smoothstep(2.4, 2.9, x));
                c = mix(c, pMain,   smoothstep(3.0, 3.6, x));
                c = mix(c, pDeep,   smoothstep(4.0, 4.6, x));
                c = mix(c, pMain,   smoothstep(5.0, 5.5, x));
                c = mix(c, pSoft,   smoothstep(6.0, 6.6, x));
                c = mix(c, pBase,   smoothstep(7.0, 7.8, x));
                return c;
            }`
        const FS = {
            pour: head + paintFn + `
                void main () { gl_FragColor = vec4(artwork(vUv), 1.0); }`,
            advect: head + paintFn + `
                uniform sampler2D uVelocity, uSource; uniform vec2 simTexel, slope;
                uniform float dt, inflow, time, ramp;
                void main () {
                    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * simTexel;
                    float inside = min(min(coord.x, coord.y), min(1.0 - coord.x, 1.0 - coord.y));
                    vec4 r = texture2D(uSource, clamp(coord, vec2(0.001), vec2(0.999)));
                    if (inflow > 0.5 && inside < 0.004) {
                        vec2 dir = normalize(slope), perp = vec2(-dir.y, dir.x);
                        float across = dot(coord - 0.5, perp);
                        float s = across * 1.6 + time + 0.35 * n1(across * 5.0 + time * 3.0);
                        vec3 fresh = mix(artwork(clamp(coord, vec2(0.0), vec2(1.0))), paint(s), ramp);
                        r.rgb = mix(r.rgb, fresh, smoothstep(0.004, -0.002, inside));
                    }
                    gl_FragColor = vec4(r.rgb, 1.0);
                }`,
            river: head + `
                uniform sampler2D uVelocity; uniform float t, flow, pull, dt, aspect, shear, meander; uniform vec2 slope;
                void main () {
                    vec2 dir = normalize(slope), perp = vec2(-dir.y, dir.x);
                    vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);
                    float along = dot(p, dir), across = dot(p, perp);
                    float speed = 1.0 + shear * (0.65 * sin(across * 6.5 + t * 0.35) + 0.35 * sin(across * 13.0 - t * 0.6 + along * 1.5));
                    float wander = meander * (sin(along * 4.2 - t * 0.5 + across * 1.7) + 0.5 * sin(along * 8.5 + t * 0.3));
                    vec2 baseV = (dir * speed + perp * wander) * flow;
                    vec2 v = texture2D(uVelocity, vUv).xy;
                    gl_FragColor = vec4(mix(v, baseV, clamp(pull * dt, 0.0, 1.0)), 0.0, 1.0);
                }`,
            viscous: head + `
                uniform sampler2D uVelocity; uniform float k;
                void main () {
                    vec2 C = texture2D(uVelocity, vUv).xy;
                    vec2 A = 0.25 * (texture2D(uVelocity, vL).xy + texture2D(uVelocity, vR).xy
                                   + texture2D(uVelocity, vT).xy + texture2D(uVelocity, vB).xy);
                    gl_FragColor = vec4(mix(C, A, k), 0.0, 1.0);
                }`,
            divergence: head + `
                uniform sampler2D uVelocity;
                void main () {
                    float L = texture2D(uVelocity, vL).x, R = texture2D(uVelocity, vR).x;
                    float T = texture2D(uVelocity, vT).y, B = texture2D(uVelocity, vB).y;
                    gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
                }`,
            curl: head + `
                uniform sampler2D uVelocity;
                void main () {
                    float L = texture2D(uVelocity, vL).y, R = texture2D(uVelocity, vR).y;
                    float T = texture2D(uVelocity, vT).x, B = texture2D(uVelocity, vB).x;
                    gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
                }`,
            vorticity: head + `
                uniform sampler2D uVelocity, uCurl; uniform float curl, dt;
                void main () {
                    float L = texture2D(uCurl, vL).x, R = texture2D(uCurl, vR).x;
                    float T = texture2D(uCurl, vT).x, B = texture2D(uCurl, vB).x;
                    float C = texture2D(uCurl, vUv).x;
                    vec2 f = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
                    f /= length(f) + 0.0001; f *= curl * C; f.y *= -1.0;
                    vec2 v = texture2D(uVelocity, vUv).xy + f * dt;
                    gl_FragColor = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
                }`,
            pressure: head + `
                uniform sampler2D uPressure, uDivergence;
                void main () {
                    float L = texture2D(uPressure, vL).x, R = texture2D(uPressure, vR).x;
                    float T = texture2D(uPressure, vT).x, B = texture2D(uPressure, vB).x;
                    float d = texture2D(uDivergence, vUv).x;
                    gl_FragColor = vec4((L + R + B + T - d) * 0.25, 0.0, 0.0, 1.0);
                }`,
            gradient: head + `
                uniform sampler2D uPressure, uVelocity;
                void main () {
                    float L = texture2D(uPressure, vL).x, R = texture2D(uPressure, vR).x;
                    float T = texture2D(uPressure, vT).x, B = texture2D(uPressure, vB).x;
                    gl_FragColor = vec4(texture2D(uVelocity, vUv).xy - vec2(R - L, T - B), 0.0, 1.0);
                }`,
            scale: head + `
                uniform sampler2D uTex; uniform float value;
                void main () { gl_FragColor = value * texture2D(uTex, vUv); }`,
            display: head + `
                uniform sampler2D uTex; uniform float seed, sat, vib;
                uniform vec3 tBase, tMix, tAccent, tSoft, tMain, tDeep;
                float hash (vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                float d2 (vec3 a, vec3 b) { vec3 d = a - b; return dot(d, d); }
                void main () {
                    vec3 o = texture2D(uTex, (vUv - 0.5) * 0.97 + 0.5).rgb;
                    vec3 k0 = vec3(0.968, 0.964, 0.982), k1 = vec3(0.925, 0.900, 0.988), k2 = vec3(0.885, 0.852, 0.983);
                    vec3 k3 = vec3(0.843, 0.912, 0.994), k4 = vec3(0.735, 0.866, 0.992), k5 = vec3(0.580, 0.828, 0.990);
                    float e0 = d2(o, k0), e1 = d2(o, k1), e2 = d2(o, k2), e3 = d2(o, k3), e4 = d2(o, k4), e5 = d2(o, k5);
                    float m = min(min(min(e0, e1), min(e2, e3)), min(e4, e5));
                    float K = 0.006;
                    float w0 = exp(-(e0 - m) / K), w1 = exp(-(e1 - m) / K), w2 = exp(-(e2 - m) / K);
                    float w3 = exp(-(e3 - m) / K), w4 = exp(-(e4 - m) / K), w5 = exp(-(e5 - m) / K);
                    vec3 c = (w0 * tBase + w1 * tMix + w2 * tAccent + w3 * tSoft + w4 * tMain + w5 * tDeep) / (w0 + w1 + w2 + w3 + w4 + w5);
                    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
                    c = mix(vec3(l), c, sat);
                    float chroma = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
                    c = mix(vec3(l), c, 1.0 + vib * (1.0 - clamp(chroma * 5.0, 0.0, 1.0)));
                    c += (hash(gl_FragCoord.xy + seed) - 0.5) * (1.5 / 255.0);
                    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
                }`,
        }

        const compile = (type, src) => {
            const s = gl.createShader(type)
            gl.shaderSource(s, src); gl.compileShader(s)
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader")
            return s
        }
        let P
        try {
            const vs = compile(gl.VERTEX_SHADER, vsSrc)
            P = {}
            for (const key of Object.keys(FS)) {
                const p = gl.createProgram()
                gl.attachShader(p, vs); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FS[key]))
                gl.bindAttribLocation(p, 0, "aPos"); gl.linkProgram(p)
                if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link")
                const u = {}
                const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
                for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name) }
                P[key] = { p, u }
            }
        } catch (e) { canvas.style.display = "none"; return }

        const quad = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, quad)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
        gl.enableVertexAttribArray(0)
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

        const fbo = (w, h) => {
            gl.activeTexture(gl.TEXTURE0)
            const tex = gl.createTexture()
            gl.bindTexture(gl.TEXTURE_2D, tex)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, halfType, null)
            const fb = gl.createFramebuffer()
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("fbo")
            gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT)
            return { tex, fb, w, h, tx: 1 / w, ty: 1 / h,
                bind(unit) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); return unit } }
        }
        const doubleFbo = (w, h) => {
            let a = fbo(w, h), b = fbo(w, h)
            return { w, h, tx: a.tx, ty: a.ty, get read() { return a }, get write() { return b }, swap() { const t = a; a = b; b = t } }
        }
        const res = (r) => {
            const asp = gl.drawingBufferWidth / gl.drawingBufferHeight
            const min = Math.round(r), max = Math.round(r * (asp < 1 ? 1 / asp : asp))
            return asp > 1 ? { w: max, h: min } : { w: min, h: max }
        }
        const blit = (target) => {
            if (target) { gl.viewport(0, 0, target.w, target.h); gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb) }
            else { gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.bindFramebuffer(gl.FRAMEBUFFER, null) }
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        }
        const use = (prog, tx, ty) => { gl.useProgram(prog.p); if (prog.u.texel) gl.uniform2f(prog.u.texel, tx, ty); return prog.u }
        const hex3 = (h) => {
            const m = /^#?([0-9a-f]{6})/i.exec(String(h).trim())
            if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
            const n = String(h).replace(/[^0-9.,]/g, "").split(",").map(Number)
            return n.length >= 3 ? [n[0] / 255, n[1] / 255, n[2] / 255] : [1, 1, 1]
        }
        let imgTex = null, imgW = 1, imgH = 1
        const setPalette = (u) => {
            if (u.pBase) gl.uniform3fv(u.pBase, ORIGINAL.base)
            if (u.pSoft) gl.uniform3fv(u.pSoft, ORIGINAL.soft)
            if (u.pAccent) gl.uniform3fv(u.pAccent, ORIGINAL.accent)
            if (u.pMain) gl.uniform3fv(u.pMain, ORIGINAL.main)
            if (u.pDeep) gl.uniform3fv(u.pDeep, ORIGINAL.deep)
            if (u.uImage) {
                gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, imgTex); gl.uniform1i(u.uImage, 5)
                const sa = canvas.width / canvas.height, ia = imgW / imgH
                const c = sa > ia ? [1, ia / sa] : [sa / ia, 1]
                gl.uniform2f(u.uCover, c[0] / 1.02, c[1] / 1.02)
            }
        }
        const setLook = (u) => {
            const s = settings.current
            const b = hex3(s.base), a = hex3(s.accent)
            gl.uniform3fv(u.tBase, b); gl.uniform3fv(u.tMix, b.map((x, i) => (x + a[i]) / 2)); gl.uniform3fv(u.tAccent, a)
            gl.uniform3fv(u.tSoft, hex3(s.soft)); gl.uniform3fv(u.tMain, hex3(s.main)); gl.uniform3fv(u.tDeep, hex3(s.deep))
            gl.uniform1f(u.sat, s.saturation / 100); gl.uniform1f(u.vib, s.vibrancy / 100)
        }

        let dye, velocity, divergence, curl, pressure
        const init = () => {
            const s = res(SIM_RES), d = res(DYE_RES)
            dye = doubleFbo(d.w, d.h)
            velocity = doubleFbo(s.w, s.h)
            divergence = fbo(s.w, s.h)
            curl = fbo(s.w, s.h)
            pressure = doubleFbo(s.w, s.h)
            const u = use(P.pour, dye.tx, dye.ty)
            setPalette(u)
            blit(dye.read)
        }
        const wantSize = () => {
            const scale = Math.min(window.devicePixelRatio || 1, 2)
            return [Math.max(1, Math.round(wrap.clientWidth * scale)), Math.max(1, Math.round(wrap.clientHeight * scale))]
        }
        const resize = () => {
            const [w, h] = wantSize()
            canvas.width = w
            canvas.height = h
            try { init() } catch (e) { canvas.style.display = "none" }
        }

        const step = (dt, t) => {
            const s = settings.current
            let u = use(P.river, velocity.tx, velocity.ty)
            gl.uniform1i(u.uVelocity, velocity.read.bind(0))
            gl.uniform1f(u.t, t); gl.uniform1f(u.flow, 9 * s.flowSpeed); gl.uniform1f(u.pull, PULL)
            gl.uniform1f(u.dt, dt); gl.uniform1f(u.aspect, canvas.width / canvas.height)
            gl.uniform1f(u.shear, SHEAR); gl.uniform1f(u.meander, MEANDER); gl.uniform2f(u.slope, SLOPE[0], SLOPE[1])
            blit(velocity.write); velocity.swap()
            u = use(P.viscous, velocity.tx, velocity.ty)
            gl.uniform1f(u.k, VISCOSITY)
            for (let i = 0; i < 3; i++) { gl.uniform1i(u.uVelocity, velocity.read.bind(0)); blit(velocity.write); velocity.swap() }

            u = use(P.curl, velocity.tx, velocity.ty)
            gl.uniform1i(u.uVelocity, velocity.read.bind(0)); blit(curl)
            u = use(P.vorticity, velocity.tx, velocity.ty)
            gl.uniform1i(u.uVelocity, velocity.read.bind(0)); gl.uniform1i(u.uCurl, curl.bind(1))
            gl.uniform1f(u.curl, SWIRL); gl.uniform1f(u.dt, dt)
            blit(velocity.write); velocity.swap()
            u = use(P.divergence, velocity.tx, velocity.ty)
            gl.uniform1i(u.uVelocity, velocity.read.bind(0)); blit(divergence)
            u = use(P.scale, pressure.tx, pressure.ty)
            gl.uniform1i(u.uTex, pressure.read.bind(0)); gl.uniform1f(u.value, 0.8)
            blit(pressure.write); pressure.swap()
            u = use(P.pressure, velocity.tx, velocity.ty)
            gl.uniform1i(u.uDivergence, divergence.bind(0))
            for (let i = 0; i < PRESSURE_ITER; i++) { gl.uniform1i(u.uPressure, pressure.read.bind(1)); blit(pressure.write); pressure.swap() }
            u = use(P.gradient, velocity.tx, velocity.ty)
            gl.uniform1i(u.uPressure, pressure.read.bind(0)); gl.uniform1i(u.uVelocity, velocity.read.bind(1))
            blit(velocity.write); velocity.swap()

            u = use(P.advect, velocity.tx, velocity.ty)
            setPalette(u)
            gl.uniform2f(u.simTexel, velocity.tx, velocity.ty); gl.uniform2f(u.slope, SLOPE[0], SLOPE[1])
            gl.uniform1i(u.uVelocity, velocity.read.bind(0)); gl.uniform1i(u.uSource, velocity.read.bind(0))
            gl.uniform1f(u.dt, dt); gl.uniform1f(u.inflow, 0); gl.uniform1f(u.time, 0); gl.uniform1f(u.ramp, 0)
            blit(velocity.write); velocity.swap()

            u = use(P.advect, dye.tx, dye.ty)
            setPalette(u)
            gl.uniform2f(u.simTexel, velocity.tx, velocity.ty); gl.uniform2f(u.slope, SLOPE[0], SLOPE[1])
            gl.uniform1i(u.uVelocity, velocity.read.bind(0)); gl.uniform1i(u.uSource, dye.read.bind(1))
            gl.uniform1f(u.dt, dt); gl.uniform1f(u.inflow, 1); gl.uniform1f(u.time, t * NEW_COLOR_SPEED); gl.uniform1f(u.ramp, 0)
            blit(dye.write); dye.swap()
        }

        let raf = 0, prev = performance.now(), visible = true, started = false
        let simT = 0, lastW = 0, lastH = 0
        // only rebuild when the size really changes (ignores mobile toolbar height jitter)
        const bigChange = () => { const [w, h] = wantSize(); return !lastW || Math.abs(w - lastW) > 2 || Math.abs(h - lastH) / Math.max(1, lastH) > 0.2 }
        const resizeIfNeeded = () => { if (!started || !bigChange()) return; resize(); [lastW, lastH] = wantSize() }
        const ro = new ResizeObserver(resizeIfNeeded)
        ro.observe(wrap)
        const io = new IntersectionObserver((es) => { visible = es[0]?.isIntersecting ?? true })
        io.observe(wrap)
        const frame = (now) => {
            raf = requestAnimationFrame(frame)
            // the clock only advances while visible, so returning to it never jumps
            if (!visible || document.hidden) { prev = now; return }
            const dt = Math.min((now - prev) / 1000, 1 / 30); prev = now
            simT += dt
            resizeIfNeeded()
            try {
                step(dt, simT)
                const u = use(P.display, 1 / canvas.width, 1 / canvas.height)
                gl.uniform1i(u.uTex, dye.read.bind(0))
                gl.uniform1f(u.seed, simT % 10)
                setLook(u)
                blit(null)
            } catch (e) { cancelAnimationFrame(raf); canvas.style.display = "none" }
        }
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => {
            imgW = img.width; imgH = img.height
            imgTex = gl.createTexture()
            gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, imgTex)
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img)
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
            started = true
            resize(); [lastW, lastH] = wantSize()
            prev = performance.now(); simT = 0
            if (stillOnly) {
                // settle the paint offscreen, then show one still frame (same look, no motion)
                try {
                    for (let i = 0; i < 420; i++) { simT += 1 / 60; step(1 / 60, simT) }
                    const u = use(P.display, 1 / canvas.width, 1 / canvas.height)
                    gl.uniform1i(u.uTex, dye.read.bind(0)); gl.uniform1f(u.seed, 1); setLook(u); blit(null)
                } catch (e) { canvas.style.display = "none" }
                return
            }
            raf = requestAnimationFrame(frame)
        }
        img.onerror = () => { canvas.style.display = "none" }
        img.src = imageSrc

        return () => {
            cancelAnimationFrame(raf)
            ro.disconnect(); io.disconnect()
        }
    }, [imageSrc, stillOnPhone])

    return (
        <div ref={wrapRef} className={className} style={{ position: "relative", overflow: "hidden", background: staticBackground, ...style }}>
            <canvas ref={canvasRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
            {fade && (
                <div aria-hidden="true" style={{
                    position: "absolute", left: 0, right: 0, bottom: 0, height: fadeHeight,
                    background: `linear-gradient(180deg, transparent 0%, ${fadeColor} 100%)`, pointerEvents: "none",
                }} />
            )}
        </div>
    )
}
