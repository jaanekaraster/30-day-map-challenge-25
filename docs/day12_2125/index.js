import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import getStarfield from "./getStarfield.js";
import { getFresnelMat } from "./getFresnelMat.js";

const w = window.innerWidth;
const h = window.innerHeight;

// Scene
const scene = new THREE.Scene();

// Camera
const camera = new THREE.PerspectiveCamera(75, w / h, 0.5, 1000);
camera.position.set(0, 0, 2);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(w, h);
renderer.setClearColor(0x000000); // black background (optional)
renderer.localClippingEnabled = true; // 🔥 REQUIRED FOR CLIPPING PLANES
document.body.appendChild(renderer.domElement);

const earthGroup = new THREE.Group();
earthGroup.rotation.z = -23.4 * Math.PI / 180;
scene.add(earthGroup);

// Orbit controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.minDistance = 1.7;  // 👈 closest zoom allowed
controls.maxDistance = 10;   // 👈 farthest zoom allowed

// new OrbitControls(camera, renderer.domElement);

// Globe geometry (high resolution)
// const sphereGeometry = new THREE.SphereGeometry(1, 128, 128);
const loader = new THREE.TextureLoader();
const detail = 12;
const geometry = new THREE.IcosahedronGeometry(1, detail);
const material = new THREE.MeshStandardMaterial({
    // map: loader.load("earthmap1k.jpg")
    // map: loader.load("jpegPIA18436.jpg") // Iapetus
    // map: loader.load("mimas_full.png")
    // map: loader.load("moonmap4k.jpg")
    // map: loader.load("titan_4005.jpeg")
    // map: loader.load("titanGlobe.png")
    map: loader.load("titan_color2.png")

});
const earthMesh = new THREE.Mesh(geometry, material);
scene.add(earthMesh);

// const lightsMat = new THREE.MeshBasicMaterial({
//     // color: 0x00ff00,
//     // transparent: true,
//     // opacity: 0.5,
//     map: loader.load("earthlights1k.jpg"),
//     blending: THREE.AdditiveBlending,
// })
// const lightsMesh = new THREE.Mesh(geometry, lightsMat);
// scene.add(lightsMesh);

const cloudsMat = new THREE.MeshStandardMaterial({
    // map: loader.load("04_earthcloudmap.jpg"),
    map: loader.load("titan_clouds1.png"),
    transparent: true, 
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
})
const cloudsMesh = new THREE.Mesh(geometry, cloudsMat);
cloudsMesh.scale.setScalar(1.003);
earthGroup.add(cloudsMesh);

const fresnelMat = getFresnelMat();
const glowMesh = new THREE.Mesh(geometry, fresnelMat);
glowMesh.scale.setScalar(1.005);
earthGroup.add(glowMesh);

const stars = getStarfield({numStars: 500});
scene.add(stars);

const sunLight = new THREE.DirectionalLight(0xffffff, 1.2); // increase intensity
sunLight.position.set(-2, 0.5, 2);
scene.add(sunLight);

// Animation loop
function animate() {
  requestAnimationFrame(animate);
//   earthMesh.rotation.x += 0.0015;
  earthMesh.rotation.y += 0.0015;
//   lightsMesh.rotation.y += 0.0015;
  cloudsMesh.rotation.y += 0.0025;
  glowMesh.rotation.y += 0.0015;
  renderer.render(scene, camera);
}
animate();
