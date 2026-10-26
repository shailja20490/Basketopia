import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const API = 'https://dummyjson.com';
const STORAGE_KEY = 'basket-world-data-v1';

const $ = (selector) => document.querySelector(selector);

let baskets = loadBaskets();
let activeBasketId = null;
let currentCategory = '';
let currentQuery = '';
let currentSkip = 0;
let totalResults = 0;
let loadingProducts = false;
let toastTimer;

let scene, camera, renderer, controls, basketGroup, productGroup;
let basketMaterial;
let animationId;
let textureLoader;
let resizeObserver;
let currentBasketColor = '#e9a8c5';
let autoRotate = false;
let raycaster, pointer;
let clickableProducts = [];
let hitTargets = [];
let textureCache = new Map();
let lastTap = 0;

function loadBaskets() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved)) return saved;
  } catch (error) {
    console.warn('Could not read saved baskets:', error);
  }
  return [];
}

function saveBaskets() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(baskets));
  } catch (error) {
    showToast('Storage is full. Your collection may not be saved.');
  }
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function formatPrice(value) {
  if (typeof value !== 'number') return '';
  return '$' + value.toFixed(2);
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2500);
}

function showHome() {
  $('#homeScreen').classList.remove('hidden');
  $('#basketScreen').classList.add('hidden');
  activeBasketId = null;
  renderBasketGrid();
}

window.showHome = showHome;

function renderBasketGrid() {
  const grid = $('#basketGrid');
  $('#basketCount').textContent =
    `${baskets.length} collection${baskets.length === 1 ? '' : 's'}`;

  if (!baskets.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div style="font-size:40px;margin-bottom:12px">🧺</div>
        <strong>Your world starts here.</strong>
        <p>Create a basket and fill it with your favourite things.</p>
      </div>`;
    return;
  }

  grid.innerHTML = baskets.map(basket => `
    <button class="basket-card" data-open-basket="${escapeHTML(basket.id)}">
      <div class="basket-preview" style="background:${safeColor(basket.color)}35">
        <span>🧺</span>
      </div>
      <strong>${escapeHTML(basket.name || 'My Basket')}</strong>
      <small>${basket.items.length} item${basket.items.length === 1 ? '' : 's'}</small>
    </button>
  `).join('');

  grid.querySelectorAll('[data-open-basket]').forEach(button => {
    button.addEventListener('click', () => openBasket(button.dataset.openBasket));
  });
}

function safeColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#e9a8c5';
}

function createBasket() {
  $('#newBasketName').value = '';
  $('#nameDialog').showModal();
  setTimeout(() => $('#newBasketName').focus(), 50);
}

window.createBasket = createBasket;

$('#createForm').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('#newBasketName').value.trim() || 'My Basket';
  const basket = {
    id: makeId(),
    name,
    color: '#e9a8c5',
    items: []
  };
  baskets.unshift(basket);
  saveBaskets();
  $('#nameDialog').close();
  openBasket(basket.id);
});

function getActiveBasket() {
  return baskets.find(basket => basket.id === activeBasketId);
}

function openBasket(id) {
  const basket = baskets.find(item => item.id === id);
  if (!basket) return;

  activeBasketId = id;
  currentBasketColor = safeColor(basket.color);
  $('#homeScreen').classList.add('hidden');
  $('#basketScreen').classList.remove('hidden');
  $('#basketName').value = basket.name;
  $('#customColor').value = currentBasketColor;

  document.querySelectorAll('.swatch').forEach(swatch => {
    swatch.classList.toggle(
      'selected',
      swatch.dataset.color.toLowerCase() === currentBasketColor.toLowerCase()
    );
  });

  initScene();
  rebuildBasket();
  loadProducts(true);
}

$('#basketName').addEventListener('input', () => {
  const basket = getActiveBasket();
  if (!basket) return;
  basket.name = $('#basketName').value;
  saveBaskets();
  renderBasketGrid();
});

function deleteBasket() {
  const basket = getActiveBasket();
  if (!basket) return;

  if (!confirm(`Delete "${basket.name}" and all its items?`)) return;

  baskets = baskets.filter(item => item.id !== activeBasketId);
  saveBaskets();
  disposeScene();
  showHome();
}

window.deleteBasket = deleteBasket;

document.querySelectorAll('.swatch').forEach(button => {
  button.addEventListener('click', () => setBasketColor(button.dataset.color));
});

$('#customColor').addEventListener('input', event => {
  setBasketColor(event.target.value);
});

function setBasketColor(color) {
  currentBasketColor = safeColor(color);
  const basket = getActiveBasket();
  if (basket) {
    basket.color = currentBasketColor;
    saveBaskets();
  }

  document.querySelectorAll('.swatch').forEach(swatch => {
    swatch.classList.toggle(
      'selected',
      swatch.dataset.color.toLowerCase() === currentBasketColor.toLowerCase()
    );
  });

  if ($('#customColor').value !== currentBasketColor) {
    $('#customColor').value = currentBasketColor;
  }

  if (basketMaterial) {
    basketMaterial.color.set(currentBasketColor);
    basketMaterial.needsUpdate = true;
  }
  renderBasketGrid();
}

function initScene() {
  disposeScene();

  const container = $('#sceneContainer');
  container.innerHTML = '';

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#f7edf4');

  camera = new THREE.PerspectiveCamera(
    38,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  camera.position.set(0, 4.2, 9.5);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9a2b6, 2.1));

  const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
  keyLight.position.set(-4, 8, 5);
  keyLight.castShadow = true;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffd6e8, 1.6);
  fillLight.position.set(5, 3, -5);
  scene.add(fillLight);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(6, 64),
    new THREE.MeshStandardMaterial({ color: '#f7edf4', roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.16;
  ground.receiveShadow = true;
  scene.add(ground);

  basketGroup = new THREE.Group();
  productGroup = new THREE.Group();
  scene.add(basketGroup);
  scene.add(productGroup);

  buildBasket();

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 6;
  controls.maxDistance = 14;
  controls.target.set(0, 1.1, 0);
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minPolarAngle = 0.3;
  controls.update();

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  renderer.domElement.addEventListener('pointerup', onScenePointerUp);
  renderer.domElement.addEventListener('dragover', event => event.preventDefault());
  renderer.domElement.addEventListener('drop', onSceneDrop);

  if (resizeObserver) resizeObserver.disconnect();
  resizeObserver = new ResizeObserver(() => {
    if (!renderer || !camera) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  });
  resizeObserver.observe(container);

  $('#rotateButton').textContent = `⟳ Auto rotate: ${autoRotate ? 'On' : 'Off'}`;

  const animate = () => {
    animationId = requestAnimationFrame(animate);
    if (!renderer || !scene || !camera) return;
    if (autoRotate && basketGroup) basketGroup.rotation.y += 0.003;
    controls?.update();
    renderer.render(scene, camera);
  };
  animate();
}

function disposeScene() {
  if (animationId) cancelAnimationFrame(animationId);
  if (resizeObserver) resizeObserver.disconnect();

  if (renderer) {
    renderer.dispose();
    renderer.domElement.remove();
  }

  if (scene) {
    scene.traverse(object => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach(material => {
          if (material.map && ![...textureCache.values()].includes(material.map)) {
            material.map.dispose();
          }
          material.dispose();
        });
      }
    });
  }

  controls?.dispose();
  scene = camera = renderer = controls = basketGroup = productGroup = null;
  basketMaterial = null;
  clickableProducts = [];
  hitTargets = [];
}

function buildBasket() {
  if (!basketGroup) return;

  basketMaterial = new THREE.MeshStandardMaterial({
    color: currentBasketColor,
    roughness: 0.65,
    metalness: 0
  });

  const darkMaterial = new THREE.MeshStandardMaterial({
    color: '#9c647e',
    roughness: 0.8
  });

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.55, 1.35, 0.2, 48, 1, false),
    basketMaterial
  );
  base.position.y = 0.35;
  base.castShadow = true;
  base.receiveShadow = true;
  basketGroup.add(base);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(1.52, 0.105, 12, 64),
    basketMaterial
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 1.42;
  rim.castShadow = true;
  basketGroup.add(rim);

  const lowerRim = new THREE.Mesh(
    new THREE.TorusGeometry(1.38, 0.055, 10, 64),
    basketMaterial
  );
  lowerRim.rotation.x = Math.PI / 2;
  lowerRim.position.y = 0.47;
  basketGroup.add(lowerRim);

  const wallSegments = 48;
  for (let i = 0; i < wallSegments; i++) {
    const angle = (i / wallSegments) * Math.PI * 2;
    const r = 1.47;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;

    const vertical = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.045, 0.99, 8),
      basketMaterial
    );
    vertical.position.set(x, 0.91, z);
    vertical.castShadow = true;
    basketGroup.add(vertical);
  }

  for (let row = 0; row < 7; row++) {
    const y = 0.53 + row * 0.135;
    const radius = 1.38 + row * 0.014;
    const cord = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.045, 8, 64),
      row % 2 === 0 ? basketMaterial : darkMaterial
    );
    cord.rotation.x = Math.PI / 2;
    cord.position.y = y;
    cord.castShadow = true;
    basketGroup.add(cord);
  }

  const handleMaterial = new THREE.MeshStandardMaterial({
    color: currentBasketColor,
    roughness: 0.6
  });

  const handle = new THREE.Mesh(
    new THREE.TorusGeometry(0.82, 0.09, 12, 48, Math.PI),
    handleMaterial
  );
  handle.position.set(0, 1.45, -0.15);
  handle.rotation.x = Math.PI;
  handle.rotation.z = Math.PI;
  handle.scale.set(1, 0.92, 1);
  basketGroup.add(handle);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1.34, 48),
    new THREE.MeshStandardMaterial({ color: currentBasketColor, roughness: 0.9 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.47;
  basketGroup.add(floor);
}

function rebuildBasket() {
  if (!productGroup) return;

  while (productGroup.children.length) {
    const child = productGroup.children.pop();
    if (child) {
      child.traverse(object => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const mats = Array.isArray(object.material) ? object.material : [object.material];
          mats.forEach(material => material.dispose());
        }
      });
    }
  }

  clickableProducts = [];
  hitTargets = [];

  const basket = getActiveBasket();
  if (!basket) return;

  $('#itemCount').textContent = `${basket.items.length} item${basket.items.length === 1 ? '' : 's'}`;

  basket.items.forEach((item, index) => {
    addProductVisual(item, index);
  });
}

function addProductVisual(item, index) {
  if (!productGroup) return;

  const count = getActiveBasket()?.items.length || 1;
  const columns = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));
  const row = Math.floor(index / columns);
  const col = index % columns;
  const x = (col - (Math.min(count, columns) - 1) / 2) * 0.58;
  const z = -0.28 + row * 0.5;
  const y = 0.62 + (index % 3) * 0.035;

  const imageUrl = item.thumbnail || item.image || item.images?.[0];

  const geometry = new THREE.PlaneGeometry(0.56, 0.72);
  const material = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y + 0.37, z);
  mesh.rotation.y = (col % 2 === 0 ? -0.12 : 0.12);
  mesh.userData.itemId = item.id;
  mesh.userData.itemIndex = index;
  mesh.userData.kind = 'basket-product';
  mesh.renderOrder = index + 1;
  productGroup.add(mesh);

  clickableProducts.push(mesh);
  hitTargets.push(mesh);

  if (imageUrl) {
    getTexture(imageUrl).then(texture => {
      if (!mesh.parent) return;
      material.map = texture;
      material.needsUpdate = true;
    }).catch(() => {
      material.color.set('#f4dce8');
      material.needsUpdate = true;
    });
  } else {
    material.color.set('#f4dce8');
  }
}

function getTexture(url) {
  if (textureCache.has(url)) return textureCache.get(url);

  const promise = new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      url,
      texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.generateMipmaps = true;
        resolve(texture);
      },
      undefined,
      reject
    );
  });

  textureCache.set(url, promise);
  return promise;
}

function onScenePointerUp(event) {
  if (!renderer || !camera || !raycaster || !pointer) return;
  if (event.pointerType === 'touch') {
    const now = Date.now();
    if (now - lastTap < 250) return;
    lastTap = now;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(hitTargets, true);

  if (hits.length) {
    const itemId = hits[0].object.userData.itemId;
    if (itemId !== undefined) removeProduct(itemId);
  }
}

function onSceneDrop(event) {
  event.preventDefault();
  const raw = event.dataTransfer?.getData('application/basket-world-product');
  if (!raw) return;

  try {
    const item = JSON.parse(raw);
    addProduct(item);
  } catch (error) {
    console.warn('Invalid dropped product:', error);
  }
}

function removeProduct(id) {
  const basket = getActiveBasket();
  if (!basket) return;

  const index = basket.items.findIndex(item => String(item.id) === String(id));
  if (index === -1) return;

  basket.items.splice(index, 1);
  saveBaskets();
  rebuildBasket();
  renderBasketGrid();
  showToast('Product removed from your basket.');
}

$('#rotateButton').addEventListener('click', () => {
  autoRotate = !autoRotate;
  $('#rotateButton').textContent = `⟳ Auto rotate: ${autoRotate ? 'On' : 'Off'}`;
});

$('#resetViewButton').addEventListener('click', () => {
  if (!camera || !controls || !basketGroup) return;
  camera.position.set(0, 4.2, 9.5);
  controls.target.set(0, 1.1, 0);
  controls.update();
  basketGroup.rotation.set(0, 0, 0);
});

$('#searchForm').addEventListener('submit', event => {
  event.preventDefault();
  currentQuery = $('#searchInput').value.trim();
  currentCategory = '';
  updateCategoryButtons();
  loadProducts(true);
});

$('#categoryList').addEventListener('click', event => {
  const button = event.target.closest('[data-category]');
  if (!button) return;

  currentCategory = button.dataset.category;
  currentQuery = '';
  $('#searchInput').value = '';
  updateCategoryButtons();
  loadProducts(true);
});

function updateCategoryButtons() {
  document.querySelectorAll('.category-chip').forEach(button => {
    button.classList.toggle(
      'active',
      button.dataset.category === currentCategory
    );
  });
}

$('#loadMoreButton').addEventListener('click', () => loadProducts(false));

async function loadProducts(reset) {
  if (loadingProducts) return;
  loadingProducts = true;

  if (reset) {
    currentSkip = 0;
    totalResults = 0;
    $('#productGrid').innerHTML = '';
    $('#resultCount').textContent = '';
    $('#loadMoreButton').classList.add('hidden');
    $('#resultsLabel').textContent = currentQuery
      ? `Results for “${currentQuery}”`
      : currentCategory
        ? currentCategory.replaceAll('-', ' ')
        : 'Popular picks';
  }

  const grid = $('#productGrid');
  const loading = document.createElement('div');
  loading.className = 'empty-state';
  loading.textContent = 'Finding products…';
  if (reset) grid.appendChild(loading);
  $('#loadMoreButton').disabled = true;

  try {
    let url;

    if (currentCategory) {
      url = `${API}/products/category/${encodeURIComponent(currentCategory)}?limit=12&skip=${currentSkip}`;
    } else if (currentQuery) {
      url = `${API}/products/search?q=${encodeURIComponent(currentQuery)}&limit=12&skip=${currentSkip}`;
    } else {
      url = `${API}/products?limit=12&skip=${currentSkip}`;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error('Catalogue request failed');

    const data = await response.json();
    if (reset) grid.innerHTML = '';

    totalResults = data.total || 0;
    const products = Array.isArray(data.products) ? data.products : [];

    if (!products.length && reset) {
      grid.innerHTML = `
        <div class="empty-state">
          <div style="font-size:32px;margin-bottom:10px">🔎</div>
          No products found. Try another search.
        </div>`;
    } else {
      grid.insertAdjacentHTML('beforeend', products.map(product => `
        <article class="product-card">
          <div class="product-image-wrap">
            <img
              class="product-image"
              src="${escapeHTML(product.thumbnail || product.images?.[0] || '')}"
              alt="${escapeHTML(product.title)}"
              loading="lazy"
              onerror="this.style.opacity='.2'">
          </div>
          <div class="product-info">
            <div class="product-title">${escapeHTML(product.title)}</div>
            <div class="product-category">${escapeHTML(product.category || 'product')}</div>
            <div class="product-bottom">
              <span class="product-price">${formatPrice(product.price)}</span>
              <button
                class="add-button"
                data-add-product="${escapeHTML(product.id)}">
                ＋ Add
              </button>
            </div>
          </div>
        </article>
      `).join(''));

      products.forEach(product => {
        const button = grid.querySelector(`[data-add-product="${CSS.escape(String(product.id))}"]`);
        if (button) button.addEventListener('click', () => addProduct(product));
      });

      currentSkip += products.length;
    }

    $('#resultCount').textContent = totalResult
