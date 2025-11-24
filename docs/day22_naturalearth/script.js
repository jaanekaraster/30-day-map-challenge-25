import * as THREE from "three";

// -----------------------------------------------------
// Scene & Camera
// -----------------------------------------------------
const container = document.getElementById("container");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const VIEW_RADIUS = 250;
const camera = new THREE.OrthographicCamera(
  -VIEW_RADIUS, VIEW_RADIUS,
  VIEW_RADIUS, -VIEW_RADIUS,
  -1000, 1000
);
camera.position.set(0, 0, 500);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

// -----------------------------------------------------
// Circular mask
// -----------------------------------------------------
const mask = document.createElement('div');
mask.style.position = 'absolute';
mask.style.top = '0';
mask.style.left = '0';
mask.style.width = '100%';
mask.style.height = '100%';
mask.style.pointerEvents = 'none';
mask.style.background = 'radial-gradient(circle at center, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 50%)';
container.appendChild(mask);

// -----------------------------------------------------
// Panning & zoom
// -----------------------------------------------------
let isDragging = false, prevX = 0, prevY = 0;
renderer.domElement.addEventListener("mousedown", e => { isDragging=true; prevX=e.clientX; prevY=e.clientY; });
renderer.domElement.addEventListener("mouseup", () => isDragging=false);
renderer.domElement.addEventListener("mousemove", e => {
  if(!isDragging) return;
  const dx = e.clientX - prevX;
  const dy = e.clientY - prevY;
  prevX = e.clientX; prevY = e.clientY;
  camera.position.x -= dx;
  camera.position.y += dy;

  const len = Math.sqrt(camera.position.x**2 + camera.position.y**2);
  if(len > VIEW_RADIUS){
    const scale = VIEW_RADIUS / len;
    camera.position.x *= scale;
    camera.position.y *= scale;
  }
});
renderer.domElement.addEventListener("wheel", e => {
  camera.zoom *= e.deltaY<0 ? 1.1 : 0.9;
  camera.updateProjectionMatrix();
});


// -----------------------------------------------------
// Zoom control
// -----------------------------------------------------
// ---------------------------
// Zoom control
// ---------------------------
const zoomRing = document.getElementById('zoomRing');
const zoomLevels = {
  zoom1: 1,
  zoom100: 5,
  zoom500: 10
};

// Label positions on the ring (0 = 12:00, clockwise)
const labelPositions = {
  zoom1: 270,   // 1x at 9:00
  zoom100: 0,   // 100x at 12:00
  zoom500: 90   // 500x at 3:00
};

function rotateRing(id){
  const labelDeg = labelPositions[id];    // current label angle
  const targetDeg = 270;                  // always move clicked label to 9:00
  // Compute CCW rotation
  let rotateDeg = (labelDeg - targetDeg + 360) % 360;
  rotateDeg = -rotateDeg;  // negative = CCW

  console.log('Zoom clicked:', id);
  console.log('Label current angle:', labelDeg);
  console.log('Rotation applied (CCW):', rotateDeg);
  console.log('Camera zoom before:', camera.zoom);

  zoomRing.style.transform = `rotate(${rotateDeg}deg)`;

  // Update camera zoom
  camera.zoom = zoomLevels[id];
  camera.updateProjectionMatrix();

  console.log('Camera zoom after:', camera.zoom);
}

// Attach listeners
document.getElementById('zoom1').addEventListener('click', () => rotateRing('zoom1'));
document.getElementById('zoom100').addEventListener('click', () => rotateRing('zoom100'));
document.getElementById('zoom500').addEventListener('click', () => rotateRing('zoom500'));

// Initialize 1x at 9:00
rotateRing('zoom1');


// -----------------------------------------------------
// Window resize
// -----------------------------------------------------
window.addEventListener("resize", ()=>{
  camera.left = -VIEW_RADIUS; camera.right = VIEW_RADIUS;
  camera.top = VIEW_RADIUS; camera.bottom = -VIEW_RADIUS;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth,window.innerHeight);
});

// -----------------------------------------------------
// Mercator projection
// -----------------------------------------------------
function mercatorXY(lon, lat){
  const x = THREE.MathUtils.degToRad(lon);
  const y = Math.log(Math.tan(Math.PI/4 + THREE.MathUtils.degToRad(lat)/2));
  return new THREE.Vector3(x, y, 0);
}

// -----------------------------------------------------
// Bounds & scaling
// -----------------------------------------------------
let mercatorBounds = { minX: Infinity, maxX:-Infinity, minY:Infinity, maxY:-Infinity };
function updateBounds(coords){ coords.forEach(([lon,lat]) => {
  const v = mercatorXY(lon,lat);
  mercatorBounds.minX = Math.min(mercatorBounds.minX,v.x);
  mercatorBounds.maxX = Math.max(mercatorBounds.maxX,v.x);
  mercatorBounds.minY = Math.min(mercatorBounds.minY,v.y);
  mercatorBounds.maxY = Math.max(mercatorBounds.maxY,v.y);
}); }

function scaleAndCenter(v){
  const width = mercatorBounds.maxX - mercatorBounds.minX;
  const height = mercatorBounds.maxY - mercatorBounds.minY;
  const scale = Math.min(VIEW_RADIUS*2 / width, VIEW_RADIUS*2 / height) * 0.8;
  const x = (v.x - (mercatorBounds.minX+mercatorBounds.maxX)/2)*scale;
  const y = (v.y - (mercatorBounds.minY+mercatorBounds.maxY)/2)*scale;
  return new THREE.Vector3(x,y,v.z);
}

// -----------------------------------------------------
// Line creation with fading shader
// -----------------------------------------------------
function createLine2D(coords,color=0x55aaff,closed=false){
  if(!coords || coords.length===0) return new THREE.Group(); // empty group
  const points = coords.map(([lon,lat])=>scaleAndCenter(mercatorXY(lon,lat)));
  if(closed) points.push(points[0].clone());
  const geom = new THREE.BufferGeometry().setFromPoints(points);
  const mat = createBlurLineMaterial(color);
  return new THREE.Line(geom,mat);
}

function createBlurLineMaterial(color){
  return new THREE.ShaderMaterial({
    uniforms: { uColor:{value:new THREE.Color(color)}, uBlurFactor:{value:0.12} },
    vertexShader: `
      varying float vZ;
      void main(){ vZ = position.z; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uBlurFactor;
      varying float vZ;
      void main(){ float alpha = 1.0 - clamp(abs(vZ)*uBlurFactor,0.0,1.0); gl_FragColor=vec4(uColor,alpha); }
    `,
    transparent:true
  });
}

// -----------------------------------------------------
// Amoeba class
// -----------------------------------------------------
class Amoeba2D {
  constructor(lakeCoords, riverCoordsArray){
    this.group = new THREE.Group();
    scene.add(this.group);

    const continentColors = {
      "Africa": 0xffaa33, "Asia": 0x33ccff, "Europe":0x2AA626,
      "North America":0xff6666,"South America":0xff99ff,
      "Oceania":0x66ffff,"Antarctica":0xffffff,"Unknown":0x888888
    };

    // Lake
    if(lakeCoords.coords && lakeCoords.coords.length>0){
      const lakeColor = continentColors[lakeCoords.continent] || continentColors["Unknown"];
      this.head = createLine2D(lakeCoords.coords, lakeColor, true);
      this.group.add(this.head);
    }

    // Rivers
    this.tail = [];
    this.tailOrigCoords = [];
    this.tailPhases = [];
    if(riverCoordsArray && riverCoordsArray.length>0){
      riverCoordsArray.forEach(r => {
        const rColor = continentColors[r.continent] || continentColors["Unknown"];
        const line = createLine2D(r.coords, rColor, false);
        this.group.add(line);
        this.tail.push(line);
        this.tailOrigCoords.push(r.coords);
        this.tailPhases.push(Math.random() * Math.PI * 2);
      });
    }

    // Random position & movement
    this.position = new THREE.Vector2(
      (Math.random()-0.5)*VIEW_RADIUS,
      (Math.random()-0.5)*VIEW_RADIUS
    );
    const angle = Math.random()*Math.PI*2;
    const speed = 0.1 + Math.random()*0.3;
    this.velocity = new THREE.Vector2(Math.cos(angle)*speed, Math.sin(angle)*speed);
  }

  update(time){
    this.position.add(this.velocity);
    if(this.position.length() > VIEW_RADIUS-50){
      const normal = this.position.clone().normalize();
      const vDotN = this.velocity.dot(normal);
      this.velocity.sub(normal.multiplyScalar(2*vDotN));
    }
    this.group.position.set(this.position.x, this.position.y, 0);

    // Tail undulation
    this.tail.forEach((line,i)=>{
      const positions = line.geometry.attributes.position;
      const coords = this.tailOrigCoords[i];
      const tailLength = Math.floor(positions.count*0.4);
      const headLength = positions.count - tailLength;
      for(let j=0;j<positions.count;j++){
        const v = scaleAndCenter(mercatorXY(coords[j][0], coords[j][1]));
        if(j>=headLength){
          const t = (j-headLength)/(tailLength-1);
          const wave = Math.sin(time*2 + t*5 + this.tailPhases[i])*10*(1-t);
          positions.setXYZ(j,v.x+wave,v.y+wave,wave*0.5);
        } else {
          positions.setXYZ(j,v.x,v.y,0);
        }
      }
      positions.needsUpdate=true;
    });
  }
}

// -----------------------------------------------------
// Initialize Amoebae (no duplicate rivers)
// -----------------------------------------------------
const amoebae = [];
async function initAmoebae() {
  const lakesResp = await fetch("lakes.geojson");
  const riversResp = await fetch("rivers.geojson");
  const lakes = await lakesResp.json();
  const rivers = await riversResp.json();

  // Compute bounds first (include all lakes + rivers)
  lakes.features.forEach(f => updateBounds(f.geometry.coordinates[0]));
  rivers.features.forEach(f => {
    const lines = f.geometry.type==="LineString"? [f.geometry.coordinates]: f.geometry.coordinates;
    lines.forEach(line => updateBounds(line));
  });

  // Draw lakes
  lakes.features.forEach(f => {
    const lakeCoords = {
      coords: f.geometry.coordinates[0],
      continent: f.properties?.continent || "Unknown"
    };
    amoebae.push(new Amoeba2D(lakeCoords, []));
  });

  // Draw rivers once
  rivers.features.forEach(f => {
    const lines = f.geometry.type==="LineString"? [f.geometry.coordinates]: f.geometry.coordinates;
    lines.forEach(line => {
      const riverCoords = { coords: line, continent: f.properties?.continent || "Unknown" };
      amoebae.push(new Amoeba2D({ coords: [], continent: riverCoords.continent }, [riverCoords]));
    });
  });
}

initAmoebae();


// Populate continent legend
const continentColors = {
  "Africa": 0xffaa33,
  "Asia": 0x33ccff,
  "Europe": 0x2AA626,
  "North America": 0xff6666,
  "South America": 0xff99ff,
};

const legendDiv = document.getElementById('continentLegend');
for (const [continent, color] of Object.entries(continentColors)) {
  const item = document.createElement('div');
  item.className = 'legendItem';
  const box = document.createElement('div');
  box.className = 'colorBox';
  box.style.background = `#${color.toString(16).padStart(6,'0')}`;
  const label = document.createElement('span');
  label.textContent = continent;
  item.appendChild(box);
  item.appendChild(label);
  legendDiv.appendChild(item);
}

// -----------------------------------------------------
// Circular background
// -----------------------------------------------------
const slideGeo = new THREE.CircleGeometry(VIEW_RADIUS,64);
const slideMat = new THREE.MeshBasicMaterial({ color:0xdddddd });
const slide = new THREE.Mesh(slideGeo,slideMat);
scene.add(slide);

// -----------------------------------------------------
// Render loop
// -----------------------------------------------------
renderer.autoClear=false;
function renderWithMask(){
  renderer.clear();
  renderer.setClearColor(0x111111,1);
  renderer.clear();
  renderer.render(scene,camera);
}

function animate(){
  requestAnimationFrame(animate);
  amoebae.forEach(a=>a.update(performance.now()*0.001));
  renderWithMask();
}
animate();
