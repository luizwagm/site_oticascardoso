/* ==========================================================================
   main.js — Óticas Cardoso
   Carrinho client-side: lê os produtos direto do DOM (data-attrs dos cards),
   persiste em localStorage e finaliza via WhatsApp. Filtros por categoria.
   ========================================================================== */
import { WHATSAPP_NUMBER } from "./config.js";

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const CART_KEY = "oticas_cart_v1";
const brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/* ------------------------------ básicos ---------------------------------- */
function initHeader() {
  const h = $(".site-header");
  const on = () => h?.classList.toggle("is-scrolled", window.scrollY > 8);
  on();
  window.addEventListener("scroll", on, { passive: true });
}
function initMobileNav() {
  const t = $(".nav-toggle"), nav = $("#primary-nav");
  if (!t || !nav) return;
  const set = (o) => { nav.classList.toggle("is-open", o); t.setAttribute("aria-expanded", String(o)); };
  t.addEventListener("click", () => set(t.getAttribute("aria-expanded") !== "true"));
  $$("a", nav).forEach((a) => a.addEventListener("click", () => set(false)));
}
function initReveal() {
  const els = $$("[data-reveal]");
  if (!("IntersectionObserver" in window)) return els.forEach((e) => e.classList.add("is-visible"));
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
  }), { threshold: 0.1, rootMargin: "0px 0px -8% 0px" });
  els.forEach((e) => io.observe(e));
}
let toastT;
function toast(msg) {
  let el = $(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add("is-visible"));
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove("is-visible"), 2600);
}

/* ------------------------------ carrinho ---------------------------------- */
const readCart = () => { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; } };
const writeCart = (items) => { localStorage.setItem(CART_KEY, JSON.stringify(items)); renderCart(); };
const cartTotal = (items) => items.reduce((s, i) => s + i.price * i.qty, 0);

function renderCart() {
  const items = readCart();
  const count = items.reduce((s, i) => s + i.qty, 0);
  $$(".cart-count").forEach((el) => { el.textContent = count; el.classList.toggle("is-visible", count > 0); });

  const body = $("#cart-body");
  if (!body) return;
  body.innerHTML = items.length
    ? items.map((i) => `
      <div class="cart-line">
        <div class="cart-line__thumb" style="background-image:url('${i.img}')"></div>
        <div>
          <div class="cart-line__name">${i.name}</div>
          <div class="cart-line__meta">${brl(i.price)}</div>
          <div class="qty">
            <button data-dec="${i.id}" aria-label="Diminuir">−</button>
            <span aria-live="polite">${i.qty}</span>
            <button data-inc="${i.id}" aria-label="Aumentar">+</button>
          </div>
        </div>
        <button class="cart-line__remove" data-remove="${i.id}">Remover</button>
      </div>`).join("")
    : `<p class="cart-drawer__empty">Sacola vazia.<br>Vamos escolher seus óculos? ✦</p>`;
  const totalEl = $("#cart-total");
  if (totalEl) totalEl.innerHTML = `<span>Total</span><strong>${brl(cartTotal(items))}</strong>`;
}

function openDrawer() {
  $("#cart-drawer")?.classList.add("is-open");
  $("#cart-backdrop")?.classList.add("is-open");
  $("#cart-drawer")?.setAttribute("aria-hidden", "false");
}
function closeDrawer() {
  $("#cart-drawer")?.classList.remove("is-open");
  $("#cart-backdrop")?.classList.remove("is-open");
  $("#cart-drawer")?.setAttribute("aria-hidden", "true");
}

function initCart() {
  $("#cart-open")?.addEventListener("click", openDrawer);
  $("#cart-close")?.addEventListener("click", closeDrawer);
  $("#cart-backdrop")?.addEventListener("click", closeDrawer);
  window.addEventListener("keydown", (e) => e.key === "Escape" && closeDrawer());

  // seleção de tamanho (PDP)
  document.addEventListener("click", (e) => {
    const sz = e.target.closest(".size-btn");
    if (!sz) return;
    sz.closest(".sizes")?.querySelectorAll(".size-btn").forEach((b) => b.setAttribute("aria-pressed", String(b === sz)));
  });

  // adicionar: lê os dados do contêiner com data-id (card da vitrine OU página do produto)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".add-btn");
    if (!btn) return;
    const card = btn.closest("[data-id]");
    if (!card) return;
    let { id, name, price, img, stock } = card.dataset;
    const stockN = stock ? parseInt(stock, 10) : 0;
    if (stock !== undefined && stockN <= 0) { toast("Produto esgotado 😢"); return; }
    // PDP: se houver grade de tamanhos, exige escolha e anexa ao item
    const sizesBox = card.querySelector(".sizes");
    if (sizesBox) {
      const chosen = sizesBox.querySelector('.size-btn[aria-pressed="true"]');
      if (!chosen) {
        toast("Escolha uma opção");
        const hint = card.querySelector(".sizes__label span");
        if (hint) hint.textContent = "· escolha um";
        return;
      }
      id = `${id}::${chosen.dataset.size}`;
      name = `${name} — Tam. ${chosen.dataset.size}`;
    }
    const items = readCart();
    const found = items.find((i) => i.id === id);
    if (found) {
      if (found.stock && found.qty >= found.stock) { toast(`Só temos ${found.stock} em estoque`); openDrawer(); return; }
      found.qty += 1;
    } else {
      items.push({ id, name, price: parseFloat(price), img, qty: 1, stock: stockN || undefined });
    }
    writeCart(items);
    toast("Na sacola ✦");
    openDrawer();
  });

  // galeria da PDP: miniatura troca a foto principal
  document.addEventListener("click", (e) => {
    const th = e.target.closest(".pdp-thumb");
    if (!th) return;
    const main = $("#pdp-main-img");
    if (main) main.src = th.dataset.src;
    th.closest(".pdp__thumbs")?.querySelectorAll(".pdp-thumb").forEach((b) => b.setAttribute("aria-pressed", String(b === th)));
  });

  // quantidade / remoção
  $("#cart-drawer")?.addEventListener("click", (e) => {
    const inc = e.target.closest("[data-inc]");
    const dec = e.target.closest("[data-dec]");
    const rm = e.target.closest("[data-remove]");
    let items = readCart();
    if (inc) {
      const it = items.find((i) => i.id === inc.dataset.inc);
      if (it.stock && it.qty >= it.stock) { toast(`Só temos ${it.stock} em estoque`); return; }
      it.qty += 1;
    }
    else if (dec) {
      const it = items.find((i) => i.id === dec.dataset.dec);
      it.qty -= 1;
      if (it.qty <= 0) items = items.filter((i) => i.id !== it.id);
    } else if (rm) items = items.filter((i) => i.id !== rm.dataset.remove);
    else return;
    writeCart(items);
  });

  // finalizar → página de checkout
  $("#cart-checkout")?.addEventListener("click", () => {
    if (!readCart().length) return;
    window.location.href = "/checkout/";
  });

  renderCart();
}

/* ------------------------------ filtros ----------------------------------- */
function applyFilter(cat) {
  $$(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.filter === cat)));
  $$("#products-grid .product").forEach((p) => {
    p.style.display = cat === "all" || p.dataset.cat === cat ? "" : "none";
  });
}
function initFilters() {
  $$(".chip").forEach((chip) => chip.addEventListener("click", () => applyFilter(chip.dataset.filter)));
  // cards de categoria pré-filtram a vitrine (mesma página)
  $$("[data-filter-link]").forEach((a) => a.addEventListener("click", () => applyFilter(a.dataset.filterLink)));
  // /loja/?cat=corrida → abre já filtrada
  const cat = new URLSearchParams(location.search).get("cat");
  if (cat && $("#products-grid")) applyFilter(cat);
}

/* ------------------------------ FAB / ano --------------------------------- */
function initFab() {
  if ($(".wa-fab")) return;
  const msg = encodeURIComponent("Olá! Vim pelo site da Óticas Cardoso 👓");
  const a = document.createElement("a");
  a.className = "wa-fab";
  a.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`;
  a.target = "_blank"; a.rel = "noopener";
  a.setAttribute("aria-label", "Falar no WhatsApp");
  a.innerHTML = `<svg class="wa-fab__icon" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M16 3C9 3 3.5 8.5 3.5 15.5c0 2.4.7 4.7 1.9 6.7L4 29l7-1.8c1.9 1 4 1.6 6 1.6 7 0 12.5-5.5 12.5-12.5S23 3 16 3Zm0 22.7c-1.8 0-3.6-.5-5.2-1.4l-.4-.2-4.1 1.1 1.1-4-.2-.4a10 10 0 0 1-1.6-5.4C5.6 9.7 10.3 5 16 5s10.4 4.7 10.4 10.5S21.7 25.7 16 25.7Zm5.7-7.8c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1a8.2 8.2 0 0 1-2.4-1.5 9 9 0 0 1-1.7-2.1c-.2-.3 0-.5.1-.7l.5-.6.3-.5c.1-.2 0-.4 0-.6l-1-2.3c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.4-1.2 1.2-1.2 2.9s1.2 3.4 1.4 3.6c.2.2 2.4 3.7 5.8 5.1.8.4 1.5.6 2 .7.8.3 1.6.2 2.2.1.7-.1 2-.8 2.2-1.6.3-.8.3-1.4.2-1.6l-.6-.3Z"/></svg><span class="wa-fab__label">Fale com a ótica</span>`;
  document.body.appendChild(a);
}
function initYear() { const y = $("#year"); if (y) y.textContent = new Date().getFullYear(); }

/* -------------------------------- boot ------------------------------------ */
function boot() { initHeader(); initMobileNav(); initReveal(); initCart(); initFilters(); initFab(); initYear(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
