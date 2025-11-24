// script.js — Node-to-node Pac-Man + 10 ghosts + fruits + scoreboard
(() => {
  // CONFIG
  const NUM_GHOSTS = 10;
  const PAC_SPEED_PX_PER_SEC = 180;   // Pac-man speed along edges (px/sec)
  const GHOST_SPEED_PX_BASE = 120;    // base ghost speed (px/sec)
  const PAC_RADIUS = 16;
  const GHOST_RADIUS = 12;
  const COLLISION_DIST_PX = 20;
  const FRUIT_COUNT = 5;
  const INVULN_AFTER_HIT_S = 1.5;     // seconds of invulnerability after hit
  const MOUTH_ANIM_SPEED = 8;         // frames per mouth open/close cycle
  const SPRITE_SCALE = 1.35;   // increase to 1.5, 2.0, etc if you want bigger
    const FRUIT_SIZE = 36; // px

  // DOM
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  // HUD (create if not present)
  let hud = document.getElementById("hud");
  if (!hud) {
    hud = document.createElement("div");
    hud.id = "hud";
    hud.style = "position:fixed;left:12px;top:12px;z-index:999;color:#fff;font-family:Arial, sans-serif;background:rgba(0,0,0,0.45);padding:8px;border-radius:6px;";
    document.body.appendChild(hud);
  }
  // ghost count element (created/updated)
  let ghostCountEl = document.getElementById("ghostCount");
  if (!ghostCountEl) {
    ghostCountEl = document.createElement("span");
    ghostCountEl.id = "ghostCount";

  }
  // Data loaded from JSON
  let rawNodes = []; // array of {id, x (lon), y (lat)}
  let rawEdges = []; // array of {u, v, coords} or similar
  let bbox = null;

  // Processed graph
  const nodesById = new Map(); // id -> {id, lon, lat, sx, sy, neighbors:[]}
  let nodeArray = [];          // array of node objects

  // Game entities
  const pac = { node: null, from: null, to: null, progress: 0, speedPx: PAC_SPEED_PX_PER_SEC, invulnUntil: 0, mouthState: 0, mouthFrame: 0 };
  const ghosts = [];
  let fruits = []; // {nodeId, x,y, emoji}

  // Game stats
  let score = 0;
  let lives = 3;

  // Animation
  let lastTs = 0;

  // Resize handling (auto-scale fill entire canvas)
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (nodeArray.length) computeScreenCoords();
  }
  window.addEventListener("resize", resizeCanvas);

  // Load JSON
  fetch("game_data1.json")
    .then(r => r.json())
    .then(data => {
      bbox = data.bbox || null;
      rawNodes = data.nodes || data.nodeList || [];
      rawEdges = data.edges || data.edges_json || [];

      if (!rawNodes.length) {
        console.error("No nodes found in game_data1.json");
        throw new Error("No nodes");
      }

      buildGraphFromRaw();
      resizeCanvas();
      initEntities();
      ghostCountEl.textContent = ghosts.length.toString();
      updateScoreboard();
      lastTs = performance.now();
      requestAnimationFrame(loop);
    })
    .catch(err => {
      console.error("Failed to load game_data1.json:", err);
      alert("Failed to load game_data1.json — check console.");
    });

  // -------------------------------
  // Graph building and scaling
  // -------------------------------
  function buildGraphFromRaw() {
    nodesById.clear();
    nodeArray = [];

    // create node entries
    rawNodes.forEach(n => {
      const id = String(n.id ?? n.osmid ?? (n[0] ?? ""));
      const lon = (n.x !== undefined) ? +n.x : +n.lon ?? +n[0];
      const lat = (n.y !== undefined) ? +n.y : +n.lat ?? +n[1];
      const nodeObj = { id, lon, lat, sx: 0, sy: 0, neighbors: [] };
      nodesById.set(id, nodeObj);
      nodeArray.push(nodeObj);
    });

    // populate adjacency from edges (robust keys)
    rawEdges.forEach(e => {
      const u = String(e.u ?? e.source ?? e.u_id ?? (e[0] ?? ""));
      const v = String(e.v ?? e.target ?? e.v_id ?? (e[1] ?? ""));
      if (nodesById.has(u) && nodesById.has(v)) {
        linkNodes(u, v);
      } else if (e.coords && Array.isArray(e.coords) && e.coords.length >= 2) {
        // try to match coords to nodes (endpoints)
        const a = findNodeByCoord(e.coords[0]);
        const b = findNodeByCoord(e.coords[e.coords.length-1]);
        if (a && b) linkNodes(a.id, b.id);
      }
    });

    // fallback: if adjacency empty, but nodes exist, try connecting near nodes from edges coords
    const anyNeighbors = nodeArray.some(n => n.neighbors.length > 0);
    if (!anyNeighbors && rawEdges.length) {
      rawEdges.forEach(e => {
        if (e.coords && e.coords.length >= 2) {
          const a = findNodeByCoord(e.coords[0]);
          const b = findNodeByCoord(e.coords[e.coords.length-1]);
          if (a && b) linkNodes(a.id, b.id);
        }
      });
    }

    computeScreenCoords();
  }

  function linkNodes(aId, bId) {
    const a = nodesById.get(aId);
    const b = nodesById.get(bId);
    if (!a || !b) return;
    if (!a.neighbors.includes(bId)) a.neighbors.push(bId);
    if (!b.neighbors.includes(aId)) b.neighbors.push(aId);
  }

  function findNodeByCoord(coord) {
    const [lon, lat] = coord;
    for (const n of nodeArray) {
      if (Math.abs(n.lon - lon) < 1e-9 && Math.abs(n.lat - lat) < 1e-9) return n;
    }
    const key = `${coord[0]},${coord[1]}`;
    if (nodesById.has(key)) return nodesById.get(key);
    return null;
  }

  // compute screen coordinates - auto scale to fill entire canvas
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  function computeScreenCoords() {
    minLon = Infinity; minLat = Infinity; maxLon = -Infinity; maxLat = -Infinity;
    for (const n of nodeArray) {
      if (n.lon < minLon) minLon = n.lon;
      if (n.lon > maxLon) maxLon = n.lon;
      if (n.lat < minLat) minLat = n.lat;
      if (n.lat > maxLat) maxLat = n.lat;
    }
    // padding
    const padLon = (maxLon - minLon) * 0.02 || 0.0001;
    const padLat = (maxLat - minLat) * 0.02 || 0.0001;
    minLon -= padLon; maxLon += padLon; minLat -= padLat; maxLat += padLat;

    const W = canvas.width || window.innerWidth;
    const H = canvas.height || window.innerHeight;
    for (const n of nodeArray) {
      n.sx = ((n.lon - minLon) / (maxLon - minLon)) * W;
      n.sy = H - ((n.lat - minLat) / (maxLat - minLat)) * H;
    }
  }

  // -------------------------------
  // Entities initialization
  // -------------------------------
  function initEntities() {
    if (nodeArray.length === 0) throw new Error("No nodes available after loading graph.");

    // pac start: center node nearest to bbox center
    const centerLon = (minLon + maxLon) / 2;
    const centerLat = (minLat + maxLat) / 2;
    let best = null, bd = Infinity;
    for (const n of nodeArray) {
      const d = (n.lon - centerLon)**2 + (n.lat - centerLat)**2;
      if (d < bd) { bd = d; best = n; }
    }
    pac.node = best;
    pac.from = best;
    pac.to = null;
    pac.progress = 0;
    pac.invulnUntil = 0;
    pac.mouthState = 0;
    pac.mouthFrame = 0;

    // ghosts spawn at random nodes and choose an initial target
    ghosts.length = 0;
    for (let i = 0; i < NUM_GHOSTS; i++) {
      const randNode = nodeArray[Math.floor(Math.random() * nodeArray.length)];
      const g = {
        node: randNode,
        from: randNode,
        to: null,
        progress: 0,
        speedPx: GHOST_SPEED_PX_BASE * (0.8 + Math.random() * 0.6),
        color: pickGhostColor(i)
      };
      chooseNextGhostTarget(g);
      ghosts.push(g);
    }

    // fruits: place on random nodes avoiding pac start and ghost start nodes
    spawnFruits(FRUIT_COUNT);
  }

  function pickGhostColor(i) {
    // classic-ish palette cycling
    const palette = ["#ff0000","#ffb8ff","#00ffff","#ff8c00","#00cc44","#ff00ff","#00aaff","#aa00ff","#ffff00","#ff4081"];
    return palette[i % palette.length];
  }

  // spawn fruits on random nodes
  const fruitEmojis = ["🍒","🍓","🍎","🍉","🍑","🍍","🥝","🥕","🍇","🍌","🍐","🍊"];
  function spawnFruits(n) {
    fruits = [];
    const used = new Set();
    // mark pac and ghosts nodes used
    used.add(pac.node.id);
    ghosts.forEach(g => used.add(g.node.id));
    const triesMax = n * 8;
    let tries = 0;
    while (fruits.length < n && tries < triesMax) {
      tries++;
      const candidate = nodeArray[Math.floor(Math.random() * nodeArray.length)];
      if (used.has(candidate.id)) continue;
      used.add(candidate.id);
      fruits.push({
        nodeId: candidate.id,
        x: candidate.sx,
        y: candidate.sy,
        emoji: fruitEmojis[Math.floor(Math.random()*fruitEmojis.length)]
      });
    }
  }

  // -------------------------------
  // Ghost & Pac movement helpers
  // -------------------------------
  function chooseNextGhostTarget(g) {
    const cur = g.node;
    const neighbors = cur.neighbors || [];
    if (!neighbors || neighbors.length === 0) {
      g.to = null;
      return;
    }
    const options = neighbors.filter(id => id !== (g.from && g.from.id));
    const pickId = options.length ? options[Math.floor(Math.random()*options.length)] : neighbors[Math.floor(Math.random()*neighbors.length)];
    g.from = g.node;
    g.to = nodesById.get(pickId);
    g.progress = 0;
  }

  // keyboard handling (node-to-node)
  const keyState = { ArrowUp:false, ArrowDown:false, ArrowLeft:false, ArrowRight:false };
  window.addEventListener('keydown', e => {
    if (e.key in keyState) { keyState[e.key] = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', e => {
    if (e.key in keyState) { keyState[e.key] = false; e.preventDefault(); }
  });

  function pickNeighborByDirection(currNode, directionKey) {
    const neighbors = currNode.neighbors || [];
    if (!neighbors || neighbors.length === 0) return null;
    let desired = {x:0,y:0};
    if (directionKey === 'ArrowUp') desired.y = -1;
    if (directionKey === 'ArrowDown') desired.y = 1;
    if (directionKey === 'ArrowLeft') desired.x = -1;
    if (directionKey === 'ArrowRight') desired.x = 1;

    let best = null, bestScore = -Infinity;
    const cx = currNode.sx, cy = currNode.sy;
    for (const nid of neighbors) {
      const n = nodesById.get(nid);
      const vx = n.sx - cx, vy = n.sy - cy;
      const vlen = Math.hypot(vx, vy) || 1;
      const dot = (vx/vlen)*desired.x + (vy/vlen)*desired.y;
      if (dot > bestScore) { bestScore = dot; best = n; }
    }
    return bestScore > 0 ? best : null;
  }

  function advanceAlongEdge(entity, dt, speedPx) {
    if (!entity.to) return false;
    const ax = entity.from.sx, ay = entity.from.sy;
    const bx = entity.to.sx, by = entity.to.sy;
    const segLen = Math.hypot(bx-ax, by-ay) || 1;
    const delta = (speedPx * dt) / segLen;
    entity.progress += delta;
    if (entity.progress >= 1) {
      entity.node = entity.to;
      entity.from = entity.to;
      entity.to = null;
      entity.progress = 0;
      return true;
    }
    return false;
  }

  // handle pac input & movement
  function handlePacInputAndMove(dt, nowSec) {
    // if currently moving, continue
    if (pac.to) {
      const reached = advanceAlongEdge(pac, dt, pac.speedPx);
      // update mouth while moving
      pac.mouthFrame += dt * MOUTH_ANIM_SPEED;
      pac.mouthState = (Math.floor(pac.mouthFrame) % 2 === 0) ? 1 : 0;
      return;
    }
    // pick first pressed arrow (priority)
    const dirOrder = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
    let chosenKey = null;
    for (const k of dirOrder) if (keyState[k]) { chosenKey = k; break; }
    if (!chosenKey) {
      // idle mouth slowly
      pac.mouthFrame += dt * (MOUTH_ANIM_SPEED/4);
      pac.mouthState = 0;
      return;
    }
    const next = pickNeighborByDirection(pac.node, chosenKey);
    if (next) {
      pac.from = pac.node;
      pac.to = next;
      pac.progress = 0;
      pac.speedPx = PAC_SPEED_PX_PER_SEC;
      pac.mouthFrame = 0;
      pac.mouthState = 1;
    }
  }

  function updateGhosts(dt) {
    for (const g of ghosts) {
      if (g.to) {
        const reached = advanceAlongEdge(g, dt, g.speedPx);
        if (reached) chooseNextGhostTarget(g);
      } else {
        chooseNextGhostTarget(g);
      }
    }
  }

  // -------------------------------
  // Collision detection & fruit pickup
  // -------------------------------
  function checkCollisions(nowSec) {
    // compute pac screen pos
    let px, py;
    if (pac.to) {
      px = pac.from.sx + (pac.to.sx - pac.from.sx) * pac.progress;
      py = pac.from.sy + (pac.to.sy - pac.from.sy) * pac.progress;
    } else {
      px = pac.node.sx; py = pac.node.sy;
    }

    // ghost collisions (respect invulnerability)
    if (nowSec >= (pac.invulnUntil || 0)) {
      for (const g of ghosts) {
        let gx, gy;
        if (g.to) {
          gx = g.from.sx + (g.to.sx - g.from.sx) * g.progress;
          gy = g.from.sy + (g.to.sy - g.from.sy) * g.progress;
        } else {
          gx = g.node.sx; gy = g.node.sy;
        }
        const d = Math.hypot(px - gx, py - gy);
        if (d < COLLISION_DIST_PX) {
          // hit
          lives = Math.max(0, lives - 1);
          pac.invulnUntil = nowSec + INVULN_AFTER_HIT_S;
          // reset pac to center node
          const centerNode = nodeArray[Math.floor(nodeArray.length / 2)];
          pac.node = centerNode; pac.from = centerNode; pac.to = null; pac.progress = 0;
        updateScoreboard();
          break;
        }
      }
    }

    // fruit collisions
    if (fruits.length) {
      const remaining = [];
      for (const f of fruits) {
        const d = Math.hypot(px - f.x, py - f.y);
        if (d < COLLISION_DIST_PX) {
          score += 1;
          updateScoreboard();
        } else {
          remaining.push(f);
        }
      }
      fruits = remaining;
    }
  }

  // -------------------------------
  // Rendering
  // -------------------------------
  function render(nowSec) {
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // draw edges once (light)
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const n of nodeArray) {
      for (const nid of n.neighbors) {
        // draw only once
        if (n.id < nid) {
          const nb = nodesById.get(nid);
          ctx.moveTo(n.sx, n.sy);
          ctx.lineTo(nb.sx, nb.sy);
        }
      }
    }
    ctx.stroke();

    // draw fruits (emojis)
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${FRUIT_SIZE}px serif`;
    for (const f of fruits) {
      ctx.fillText(f.emoji, f.x, f.y + 1);
    }

    // draw ghosts (Pac-Man style shapes)
    for (const g of ghosts) {
      let gx, gy;
      if (g.to) {
        gx = g.from.sx + (g.to.sx - g.from.sx) * g.progress;
        gy = g.from.sy + (g.to.sy - g.from.sy) * g.progress;
      } else {
        gx = g.node.sx; gy = g.node.sy;
      }
      drawGhost(gx, gy, g.color);
    }

    // draw pac (with mouth and facing direction)
    let px, py, angle = 0;
    if (pac.to) {
      px = pac.from.sx + (pac.to.sx - pac.from.sx) * pac.progress;
      py = pac.from.sy + (pac.to.sy - pac.from.sy) * pac.progress;
      angle = Math.atan2((pac.to.sy - pac.from.sy), (pac.to.sx - pac.from.sx));
    } else {
      px = pac.node.sx; py = pac.node.sy;
      // deduce angle from last key pressed
      if (keyState.ArrowUp) angle = -Math.PI/2;
      else if (keyState.ArrowDown) angle = Math.PI/2;
      else if (keyState.ArrowLeft) angle = Math.PI;
      else if (keyState.ArrowRight) angle = 0;
    }
    drawPac(px, py, angle, pac.mouthState === 1);

    // draw HUD overlayed (score & lives already in HTML)
    // Draw a small lives/score on canvas for redundancy
    ctx.fillStyle = "#fff";
    ctx.font = "16px Arial";
    // ctx.fillText(`Score: ${score}`, canvas.width - 140, 24);
    // ctx.fillText(`Lives: ${lives}`, canvas.width - 140, 44);
  }

  function drawGhost(x, y, color) {
    const r = GHOST_RADIUS*SPRITE_SCALE;
    ctx.save();
    ctx.translate(x, y);

    // head semicircle
    ctx.beginPath();
    ctx.fillStyle = color || "#f00";
    ctx.arc(0, 0, r, Math.PI, 0);
    ctx.lineTo(r, r*0.7);
    // bottom wavy feet (3 bumps)
    const bumps = 3;
    for (let i=0;i<bumps;i++) {
      const cx = r - (i*(2*r)/bumps) - (2*r/bumps)/2;
      const cy = r*0.7 + ((i%2===0)? -r*0.18 : r*0.18);
      ctx.quadraticCurveTo(cx, cy, r - ( (i+1)*(2*r)/bumps ), r*0.7);
    }
    ctx.closePath();
    ctx.fill();

    // eyes
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(-r*0.35, -r*0.15, r*0.28, r*0.35, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(r*0.05, -r*0.15, r*0.28, r*0.35, 0, 0, Math.PI*2);
    ctx.fill();

    // pupils
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(-r*0.35, -r*0.12, r*0.12, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r*0.05, -r*0.12, r*0.12, 0, Math.PI*2);
    ctx.fill();

    ctx.restore();
  }

  function drawPac(x, y, angle, mouthOpen) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = "yellow";

    const r = PAC_RADIUS;
    // mouth angle based on mouthOpen
    const m = mouthOpen ? 0.28 : 0.04;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, m, -m);
    ctx.closePath();
    ctx.fill();

    // eye (position relative to orientation)
    ctx.fillStyle = "black";
    ctx.beginPath();
    ctx.arc(r*0.2, -r*0.45, r*0.12, 0, Math.PI*2);
    ctx.fill();

    ctx.restore();
  }

  // -------------------------------
  // HUD update
  // -------------------------------
 
  // HUD ELEMENTS
const scoreEl = document.getElementById("score");
const livesEl = document.getElementById("lives");

// Update scoreboard
function updateScoreboard() {
    scoreEl.textContent = `Score: ${score}`;
    livesEl.textContent = "❤️".repeat(lives);
}

  // -------------------------------
  // Main loop
  // -------------------------------
  function loop(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000; // seconds
    lastTs = ts;
    const nowSec = ts/1000;

    // input + movement
    handlePacInputAndMove(dt, nowSec);
    updateGhosts(dt);

    // check collisions and pickups
    checkCollisions(nowSec);

    // render
    render(nowSec);

    // update HUD DOM
    updateScoreboard();

    // game over handling (simple)
    if (lives <= 0) {
      // show Game Over overlay briefly and reset game
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle = "white";
      ctx.font = "48px Arial";
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", canvas.width/2, canvas.height/2 - 20);
      ctx.font = "20px Arial";
      ctx.fillText("Press R to restart", canvas.width/2, canvas.height/2 + 20);

      // wait for 'R' press to restart
      window.addEventListener('keydown', function onR(e) {
        if (e.key.toLowerCase() === 'r') {
          window.removeEventListener('keydown', onR);
          // reset stats and respawn
          score = 0;
          lives = 3;
          spawnFruits(FRUIT_COUNT);
          initEntities();
        updateScoreboard();
          lastTs = performance.now();
        }
      }, { once: true });

      return; // stop updating until restart
    }

    requestAnimationFrame(loop);
  }

  // Start the game once JSON has loaded and initEntities has been called
  // (initEntities was called earlier upon JSON load in fetch callback)
})();
