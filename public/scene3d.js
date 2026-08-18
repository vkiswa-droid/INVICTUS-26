/* INVICTUS 2026 — 3D motion layer (Three.js) */
(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof THREE === "undefined") return;

  const clock = new THREE.Clock();
  let scrollY = window.scrollY, targetScrollY = window.scrollY;
  window.addEventListener("scroll", () => { targetScrollY = window.scrollY; }, { passive: true });

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener("pointermove", e => {
    mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  /* ---------- 1. AMBIENT STARFIELD BACKGROUND (full page) ---------- */
  (function backdrop() {
    const canvas = document.getElementById("bg3d");
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 1, 2000);
    camera.position.z = 420;

    // layered particle fields for parallax depth
    const layers = [];
    const palette = [0x7c3cff, 0x36a9ff, 0xec4dff, 0xffffff];
    for (let L = 0; L < 3; L++) {
      const count = 260 - L * 60;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 1800;
        pos[i * 3 + 1] = (Math.random() - 0.5) * 1800;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 900 - L * 200;
      }
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color: palette[L % palette.length],
        size: 2.6 - L * 0.5,
        transparent: true,
        opacity: 0.55 - L * 0.12,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const pts = new THREE.Points(geo, mat);
      scene.add(pts);
      layers.push({ pts, speed: 0.02 + L * 0.015 });
    }

    // slowly drifting wireframe icosahedron far in the background for depth
    const bgGeo = new THREE.IcosahedronGeometry(260, 1);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x4a2fae, wireframe: true, transparent: true, opacity: 0.12 });
    const bgMesh = new THREE.Mesh(bgGeo, bgMat);
    bgMesh.position.set(260, -120, -400);
    scene.add(bgMesh);

    function resize() {
      const w = innerWidth, h = innerHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    addEventListener("resize", resize);

    function animate() {
      requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      scrollY += (targetScrollY - scrollY) * 0.06;
      mouse.x += (mouse.tx - mouse.x) * 0.03;
      mouse.y += (mouse.ty - mouse.y) * 0.03;

      layers.forEach((l, i) => {
        l.pts.rotation.y = t * l.speed;
        l.pts.rotation.x = t * l.speed * 0.4;
        l.pts.position.y = scrollY * (0.05 + i * 0.02) * -1;
      });
      bgMesh.rotation.y = t * 0.05;
      bgMesh.rotation.x = t * 0.03;

      camera.position.x += (mouse.x * 40 - camera.position.x) * 0.04;
      camera.position.y += (-mouse.y * 30 - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    }
    if (!reduceMotion) animate(); else renderer.render(scene, camera);
  })();

  /* ---------- 2. HERO CORE OBJECT ---------- */
  (function heroCore() {
    const canvas = document.getElementById("hero3d");
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 7;

    const group = new THREE.Group();
    scene.add(group);

    // glowing inner core
    const coreGeo = new THREE.IcosahedronGeometry(1.35, 1);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x9b5bff, transparent: true, opacity: 0.16 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);

    // outer wireframe shell
    const shellGeo = new THREE.IcosahedronGeometry(2.05, 1);
    const shellEdges = new THREE.EdgesGeometry(shellGeo);
    const shellMat = new THREE.LineBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.85 });
    const shell = new THREE.LineSegments(shellEdges, shellMat);
    group.add(shell);

    // secondary rotated shell for a layered look
    const shell2Geo = new THREE.IcosahedronGeometry(2.55, 0);
    const shell2Edges = new THREE.EdgesGeometry(shell2Geo);
    const shell2Mat = new THREE.LineBasicMaterial({ color: 0xec4dff, transparent: true, opacity: 0.35 });
    const shell2 = new THREE.LineSegments(shell2Edges, shell2Mat);
    group.add(shell2);

    // orbiting particle ring
    const ringCount = 140;
    const ringGeo = new THREE.BufferGeometry();
    const ringPos = new Float32Array(ringCount * 3);
    for (let i = 0; i < ringCount; i++) {
      const a = (i / ringCount) * Math.PI * 2;
      const r = 3.3 + Math.sin(a * 6) * 0.15;
      ringPos[i * 3] = Math.cos(a) * r;
      ringPos[i * 3 + 1] = Math.sin(a * 3) * 0.4;
      ringPos[i * 3 + 2] = Math.sin(a) * r;
    }
    ringGeo.setAttribute("position", new THREE.BufferAttribute(ringPos, 3));
    const ringMat = new THREE.PointsMaterial({ color: 0x3ebdff, size: 0.065, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const ring = new THREE.Points(ringGeo, ringMat);
    group.add(ring);

    const light = new THREE.PointLight(0x7c3cff, 2, 20);
    light.position.set(3, 3, 4);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x223, 1));

    function size() {
      const s = wrap.clientWidth;
      renderer.setSize(s, s);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
    }
    size();
    addEventListener("resize", size);

    function animate() {
      requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      group.rotation.y = t * 0.35 + mouse.x * 0.5;
      group.rotation.x = Math.sin(t * 0.25) * 0.15 - mouse.y * 0.3;
      shell2.rotation.y = -t * 0.2;
      ring.rotation.y = t * 0.6;
      core.scale.setScalar(1 + Math.sin(t * 1.6) * 0.05);
      renderer.render(scene, camera);
    }
    if (!reduceMotion) animate(); else { group.rotation.set(0.3, 0.5, 0); renderer.render(scene, camera); }
  })();
})();
