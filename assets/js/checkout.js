/* ==========================================================================
   checkout.js — Óticas Cardoso · página /checkout/
   Lê o carrinho (localStorage), calcula frete/cupom/total e fecha o pedido
   via WhatsApp (mock de produção — gateway de pagamento entra depois).
   Regras: frete R$ 19,90 · grátis ≥ R$ 299 · retirada na loja grátis.
   Cupom: CARDOSO10 = 10%.
   ========================================================================== */
import { WHATSAPP_NUMBER } from "./config.js";

const $ = (s, c = document) => c.querySelector(s);
const CART_KEY = "oticas_cart_v1";
const brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const FREE_MIN = 299;
const FLAT_SHIP = 19.9;
const COUPONS = { CARDOSO10: 0.1 };

const readCart = () => { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; } };
const writeCart = (items) => { localStorage.setItem(CART_KEY, JSON.stringify(items)); render(); };

const state = { coupon: null };

const subtotal = () => readCart().reduce((s, i) => s + i.price * i.qty, 0);
const shipMode = () => document.querySelector('input[name="entrega"]:checked')?.value || "envio";
const shipping = () => (shipMode() === "retirada" ? 0 : subtotal() >= FREE_MIN ? 0 : FLAT_SHIP);
const discount = () => (state.coupon ? subtotal() * COUPONS[state.coupon] : 0);
const total = () => Math.max(0, subtotal() - discount() + shipping());

/* ------------------------------- render ----------------------------------- */
function render() {
  const items = readCart();
  const empty = !items.length;
  $("#co-empty").hidden = !empty;
  $("#co-wrap").style.display = empty ? "none" : "";
  if (empty) return;

  $("#co-list").innerHTML = items.map((i) => `
    <div class="co-item">
      <div class="co-item__thumb" style="background-image:url('${i.img}')"></div>
      <div>
        <div class="co-item__name">${i.name}</div>
        <div class="co-item__unit">${brl(i.price)} / un.</div>
        <div class="qty" style="margin-top:.4rem">
          <button data-dec="${i.id}" aria-label="Diminuir">−</button>
          <span aria-live="polite">${i.qty}</span>
          <button data-inc="${i.id}" aria-label="Aumentar">+</button>
        </div>
      </div>
      <div class="co-item__right">
        <span class="co-item__price">${brl(i.price * i.qty)}</span>
        <button class="co-item__remove" data-remove="${i.id}">Remover</button>
      </div>
    </div>`).join("");

  // resumo
  $("#sum-subtotal").textContent = brl(subtotal());
  const ship = shipping();
  const shipRow = $("#ship-row");
  $("#sum-ship").textContent = ship === 0 ? (shipMode() === "retirada" ? "Grátis (retirada)" : "Grátis ✦") : brl(ship);
  shipRow.classList.toggle("summary__row--free", ship === 0);
  const discRow = $("#disc-row");
  discRow.hidden = !state.coupon;
  if (state.coupon) $("#sum-disc").textContent = `− ${brl(discount())}`;
  $("#sum-total").textContent = brl(total());

  // endereço só no envio
  $("#address-box").style.display = shipMode() === "envio" ? "" : "none";
}

/* ------------------------------- eventos ----------------------------------- */
function initEvents() {
  $("#co-list").addEventListener("click", (e) => {
    const inc = e.target.closest("[data-inc]");
    const dec = e.target.closest("[data-dec]");
    const rm = e.target.closest("[data-remove]");
    let items = readCart();
    if (inc) {
      const it = items.find((i) => i.id === inc.dataset.inc);
      if (it.stock && it.qty >= it.stock) return; // respeita estoque
      it.qty += 1;
    } else if (dec) {
      const it = items.find((i) => i.id === dec.dataset.dec);
      it.qty -= 1;
      if (it.qty <= 0) items = items.filter((i) => i.id !== it.id);
    } else if (rm) items = items.filter((i) => i.id !== rm.dataset.remove);
    else return;
    writeCart(items);
  });

  document.querySelectorAll('input[name="entrega"]').forEach((r) => r.addEventListener("change", render));

  $("#coupon-btn").addEventListener("click", () => {
    const code = ($("#coupon").value || "").trim().toUpperCase();
    const note = $("#coupon-note");
    if (COUPONS[code]) {
      state.coupon = code;
      note.className = "pill-note pill-note--ok";
      note.textContent = `Cupom ${code} aplicado — ${COUPONS[code] * 100}% off!`;
    } else {
      state.coupon = null;
      note.className = "pill-note pill-note--err";
      note.textContent = "Cupom inválido. Tenta CARDOSO10 😉";
    }
    note.hidden = false;
    render();
  });

  $("#place-order").addEventListener("click", placeOrder);
}

/* ----------------------------- fechar pedido -------------------------------- */
function placeOrder() {
  const items = readCart();
  if (!items.length) return;
  const form = $("#co-form");
  // valida dados + endereço quando for envio
  const needAddress = shipMode() === "envio";
  const required = ["nome", "whatsapp", ...(needAddress ? ["cep", "cidade", "endereco"] : [])];
  for (const id of required) {
    const el = $("#" + id);
    if (!el.value.trim()) {
      el.focus();
      el.reportValidity ? (el.required = true, form.reportValidity?.()) : null;
      el.style.borderColor = "#ff5c7a";
      return;
    }
    el.style.borderColor = "";
  }

  const d = (id) => $("#" + id).value.trim();
  const pay = document.querySelector('input[name="pagamento"]:checked')?.value || "A combinar";
  const lines = items.map((i) => `• ${i.qty}x ${i.name} — ${brl(i.price * i.qty)}`).join("\n");
  const entrega = shipMode() === "retirada"
    ? "Retirada na loja (Caruaru-PE)"
    : `Envio — CEP ${d("cep")} · ${d("endereco")} · ${d("cidade")}`;

  const msg = encodeURIComponent(
    `*Pedido — Óticas Cardoso* 👓\n\n${lines}\n\n` +
    `Subtotal: ${brl(subtotal())}\n` +
    (state.coupon ? `Cupom ${state.coupon}: − ${brl(discount())}\n` : "") +
    `Frete: ${shipping() === 0 ? "Grátis" : brl(shipping())}\n` +
    `*Total: ${brl(total())}*\n\n` +
    `Pagamento: ${pay}\n` +
    `Entrega: ${entrega}\n\n` +
    `*Cliente:* ${d("nome")}\nWhatsApp: ${d("whatsapp")}` +
    (d("email") ? `\nE-mail: ${d("email")}` : "")
  );
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`, "_blank", "noopener");
  localStorage.removeItem(CART_KEY);
  $("#co-wrap").style.display = "none";
  $("#co-success").classList.add("on");
  window.scrollTo({ top: 0 });
}

/* -------------------------------- boot -------------------------------------- */
function boot() { initEvents(); render(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
