"use strict";

function createCardBoard({ grid, scroll, shelf, pinnedGrid, swap = false, onMoveStart }) {
  const cards = new Map();
  const pinned = new Set();
  const animations = new WeakMap();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const surfaces = [
    { grid, scroll, pinned: false },
    { grid: pinnedGrid, scroll: pinnedGrid, pinned: true },
  ];
  let order = [];
  let featured = null;
  let drag;
  let frame = 0;
  let ignoreClick = false;

  function keys(surface) {
    return order.filter((key) => pinned.has(key) === surface.pinned);
  }

  function place(surface) {
    const items = keys(surface);
    if (items.includes(featured)) {
      items.splice(items.indexOf(featured), 1);
      items.unshift(featured);
    }
    let next = surface.grid.firstElementChild;
    for (const key of items) {
      const card = cards.get(key);
      if (card === next) {
        next = next.nextElementSibling;
      } else if (surface.grid.moveBefore && card.isConnected) {
        surface.grid.moveBefore(card, next);
      } else {
        surface.grid.insertBefore(card, next);
      }
    }
    surface.grid.dataset.count = String(items.length);
    surface.grid.classList.toggle("many-cards", items.length > 4);
    surface.grid.classList.toggle("large-board", items.length > 8);
  }

  function draw() {
    shelf.hidden = pinned.size === 0;
    surfaces.forEach(place);
  }

  function moveGroup(surface, next, moving) {
    const group = new Set(next);
    const before = new Map();
    if (!reducedMotion.matches) {
      for (const key of next) {
        if (key !== moving) before.set(key, cards.get(key).getBoundingClientRect());
      }
    }
    let index = 0;
    order = order.map((key) => group.has(key) ? next[index++] : key);
    for (const key of before.keys()) animations.get(cards.get(key))?.cancel();
    place(surface);
    const moves = [...before].map(([key, previous]) => {
      const card = cards.get(key);
      const current = card.getBoundingClientRect();
      return [card, previous.left - current.left, previous.top - current.top];
    });
    for (const [card, dx, dy] of moves) animateFrom(card, dx, dy);
  }

  function animateFrom(card, dx, dy) {
    if (reducedMotion.matches || Math.abs(dx) + Math.abs(dy) < 1) return;
    animations.get(card)?.cancel();
    animations.set(card, card.animate([
      { transform: "translate(" + dx + "px," + dy + "px)" },
      { transform: "translate(0,0)" },
    ], { duration: 155, easing: "cubic-bezier(.2,.75,.27,1)" }));
  }

  function movedOrder(items, from, to) {
    const result = items.slice();
    if (swap) {
      [result[from], result[to]] = [result[to], result[from]];
    } else {
      result.splice(to, 0, result.splice(from, 1)[0]);
    }
    return result;
  }

  function previewCard(card, rect) {
    const ghost = card.cloneNode(true);
    const original = card.querySelector("video:not([hidden])");
    if (original?.videoWidth && original.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const frame = document.createElement("canvas");
      frame.width = Math.min(original.videoWidth, 480);
      frame.height = Math.max(1, Math.round(frame.width * original.videoHeight / original.videoWidth));
      frame.getContext("2d").drawImage(original, 0, 0, frame.width, frame.height);
      ghost.querySelector("video").replaceWith(frame);
    }
    ghost.classList.add("card-ghost");
    ghost.style.width = rect.width + "px";
    ghost.style.height = rect.height + "px";
    ghost.inert = true;
    ghost.setAttribute("aria-hidden", "true");
    ghost.removeAttribute("data-sort-key");
    document.body.append(ghost);
    return ghost;
  }

  function begin(event) {
    const rect = drag.card.getBoundingClientRect();
    onMoveStart?.();
    const { surface, key } = drag;
    drag.items = keys(surface);
    drag.from = drag.to = drag.items.indexOf(key);
    drag.slots = drag.items.map((id) => {
      const card = cards.get(id);
      animations.get(card)?.cancel();
      return card.getBoundingClientRect();
    });
    drag.scrollTop = surface.scroll.scrollTop;
    drag.offsetX = drag.x0 - rect.left;
    drag.offsetY = drag.y0 - rect.top;
    drag.ghost = previewCard(drag.card, rect);
    drag.card.classList.add("card-lifted");
    document.body.classList.add("card-dragging");
    surface.grid.setPointerCapture(event.pointerId);
  }

  function pointInside(rect, x, y) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function tick() {
    frame = 0;
    if (!drag?.ghost) return;
    const { x, y, surface } = drag;
    const scroller = surface.scroll;
    const bounds = scroller.getBoundingClientRect();
    const edge = 34;
    const previousScroll = scroller.scrollTop;
    const inside = pointInside(bounds, x, y);
    if (inside && y < bounds.top + edge) {
      scroller.scrollTop -= Math.ceil((bounds.top + edge - y) / 4);
    } else if (inside && y > bounds.bottom - edge) {
      scroller.scrollTop += Math.ceil((y - bounds.bottom + edge) / 4);
    }
    drag.inside = inside;
    drag.ghost.style.transform = "translate3d(" + (x - drag.offsetX) + "px," + (y - drag.offsetY) + "px,0)";
    const scrollOffset = scroller.scrollTop - drag.scrollTop;
    let target = drag.from;
    let distance = Infinity;
    if (inside) {
      for (const [index, slot] of drag.slots.entries()) {
        const localY = y + scrollOffset;
        const dx = Math.max(0, slot.left - x, x - slot.right);
        const dy = Math.max(0, slot.top - localY, localY - slot.bottom);
        const tie = Math.abs(x - (slot.left + slot.right) / 2) + Math.abs(localY - (slot.top + slot.bottom) / 2);
        const score = dx * dx + dy * dy + tie * 0.001;
        if (score < distance) {
          distance = score;
          target = index;
        }
      }
    }
    if (target !== drag.to) {
      drag.to = target;
      moveGroup(surface, movedOrder(drag.items, drag.from, target), drag.key);
    }
    if (scroller.scrollTop !== previousScroll) frame = requestAnimationFrame(tick);
  }

  function finish(commit) {
    if (!drag) return false;
    const current = drag;
    drag = null;
    cancelAnimationFrame(frame);
    frame = 0;
    if (!current.ghost) return false;
    if ((!commit || !current.inside) && current.to !== current.from) {
      moveGroup(current.surface, current.items, current.key);
    }
    const lifted = current.ghost.getBoundingClientRect();
    current.ghost.remove();
    current.card.classList.remove("card-lifted");
    document.body.classList.remove("card-dragging");
    if (commit && current.inside) {
      const landed = current.card.getBoundingClientRect();
      animateFrom(current.card, lifted.left - landed.left, lifted.top - landed.top);
    }
    const surface = current.surface.grid;
    if (surface.hasPointerCapture(current.pointer)) surface.releasePointerCapture(current.pointer);
    ignoreClick = true;
    setTimeout(() => { ignoreClick = false; }, 0);
    return true;
  }

  function pointerDown(event, surface) {
    if (drag || event.button !== 0 || !event.isPrimary) return;
    const target = event.target;
    const card = target.closest("[data-sort-key]");
    if (!card || card.parentElement !== surface.grid) return;
    const control = target.closest("button,input,select,textarea,a,[data-no-sort]");
    if (control && !control.hasAttribute("data-drag-handle")) return;
    drag = { key: card.dataset.sortKey, card, surface, pointer: event.pointerId,
      x0: event.clientX, y0: event.clientY, x: event.clientX, y: event.clientY };
  }

  window.addEventListener("pointermove", (event) => {
    if (drag?.pointer !== event.pointerId) return;
    if (event.pointerType === "mouse" && !(event.buttons & 1)) {
      finish(false);
      return;
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.ghost) {
      if (Math.hypot(drag.x - drag.x0, drag.y - drag.y0) < 6) return;
      if (keys(drag.surface).length < 2) return;
      begin(event);
    }
    event.preventDefault();
    if (!frame) frame = requestAnimationFrame(tick);
  }, { passive: false });

  window.addEventListener("pointerup", (event) => {
    if (drag?.pointer !== event.pointerId) return;
    if (drag.ghost) {
      drag.x = event.clientX;
      drag.y = event.clientY;
      cancelAnimationFrame(frame);
      tick();
    }
    finish(true);
  });
  window.addEventListener("pointercancel", (event) => {
    if (drag?.pointer === event.pointerId) finish(false);
  });
  window.addEventListener("blur", () => finish(false));
  window.addEventListener("resize", () => finish(false));
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && finish(false)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  for (const surface of surfaces) {
    surface.grid.addEventListener("pointerdown", (event) => pointerDown(event, surface));
    surface.grid.addEventListener("lostpointercapture", (event) => {
      if (drag?.pointer === event.pointerId && !event.buttons) finish(false);
    });
    surface.grid.addEventListener("click", (event) => {
      if (ignoreClick && event.detail > 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    surface.grid.addEventListener("keydown", (event) => {
      if (!event.altKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      const handle = event.target.closest("[data-drag-handle]");
      const card = handle?.closest("[data-sort-key]");
      if (!card) return;
      event.preventDefault();
      onMoveStart?.();
      const items = keys(surface);
      const from = items.indexOf(card.dataset.sortKey);
      const cols = Number(getComputedStyle(surface.grid).getPropertyValue("--columns").trim()) || 1;
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[event.key];
      const to = Math.max(0, Math.min(items.length - 1, from + step));
      if (from !== to) moveGroup(surface, movedOrder(items, from, to), card.dataset.sortKey);
      handle.focus({ preventScroll: true });
    });
  }

  return {
    add(key, card) {
      finish(false);
      card.dataset.sortKey = key;
      cards.set(key, card);
      order.push(key);
      draw();
    },
    remove(key) {
      finish(false);
      cards.get(key)?.remove();
      cards.delete(key);
      pinned.delete(key);
      order = order.filter((item) => item !== key);
      draw();
    },
    togglePin(key) {
      finish(false);
      const card = cards.get(key);
      if (!card) return;
      const enable = !pinned.has(key);
      if (enable) pinned.add(key);
      else pinned.delete(key);
      card.classList.toggle("pinned-card", enable);
      const button = card.querySelector("[data-card-pin]");
      const label = (enable ? "Unpin " : "Pin ") + button.dataset.cardPin;
      button.setAttribute("aria-pressed", String(enable));
      button.setAttribute("aria-label", label);
      button.title = label;
      draw();
      button.focus({ preventScroll: true });
    },
    feature(key) {
      if (featured === key) return;
      cards.get(featured)?.classList.remove("featured-card");
      featured = key;
      cards.get(featured)?.classList.add("featured-card");
      draw();
    },
    cancelDrag() {
      finish(false);
    },
  };
}
