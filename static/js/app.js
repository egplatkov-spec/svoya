// Клуб «Своя»: меню на телефоне, фильтры расписания, подтверждения, автоскрытие сообщений.
(function () {
  "use strict";

  // Мобильное меню
  const toggle = document.querySelector("[data-nav-toggle]");
  const mobileNav = document.querySelector("[data-mobile-nav]");
  if (toggle && mobileNav) {
    toggle.addEventListener("click", () => {
      const open = mobileNav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    mobileNav.addEventListener("click", (e) => {
      if (e.target.closest("a")) mobileNav.classList.remove("open");
    });
  }

  // Подтверждение опасных действий: <form data-confirm="Точно?">
  document.addEventListener("submit", (e) => {
    const form = e.target;
    const msg = form.getAttribute("data-confirm");
    if (msg && !window.confirm(msg)) {
      e.preventDefault();
      return;
    }
    // Защита от двойной отправки
    const btn = form.querySelector("button[type=submit], button:not([type])");
    if (btn && !form.hasAttribute("data-no-lock")) {
      setTimeout(() => { btn.disabled = true; }, 0);
      setTimeout(() => { btn.disabled = false; }, 8000);
    }
  });

  // Сообщения: закрытие и автоскрытие
  document.querySelectorAll(".flash").forEach((el) => {
    el.querySelector("button")?.addEventListener("click", () => el.remove());
    if (!el.classList.contains("error")) setTimeout(() => el.remove(), 7000);
  });

  // Фильтры расписания: <button data-filter="soft">, элементы с data-tags="soft,beginner"
  const chips = document.querySelectorAll("[data-filter]");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const tag = chip.getAttribute("data-filter");
      chips.forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      document.querySelectorAll("[data-tags]").forEach((el) => {
        const tags = el.getAttribute("data-tags").split(",");
        el.classList.toggle("dim", tag !== "all" && !tags.includes(tag));
      });
    });
  });

  // Маска телефона: подставляем +7 и форматируем по мере ввода
  document.querySelectorAll("input[type=tel]").forEach((input) => {
    input.addEventListener("focus", () => { if (!input.value) input.value = "+7 "; });
    input.addEventListener("input", (e) => {
      if (e.inputType && e.inputType.startsWith("delete")) return; // не мешаем стирать
      let d = input.value.replace(/\D/g, "");
      if (d.startsWith("8")) d = "7" + d.slice(1);
      if (!d.startsWith("7")) d = "7" + d;
      d = d.slice(0, 11);
      const p = [d.slice(1, 4), d.slice(4, 7), d.slice(7, 9), d.slice(9, 11)];
      let out = "+7";
      if (p[0]) out += " (" + p[0];
      if (p[0].length === 3) out += ")";
      if (p[1]) out += " " + p[1];
      if (p[2]) out += "-" + p[2];
      if (p[3]) out += "-" + p[3];
      input.value = out;
    });
  });

  // Яркость экрана пропуска: просим не гасить экран, пока открыт QR
  if (document.querySelector("[data-wake-lock]") && "wakeLock" in navigator) {
    navigator.wakeLock.request("screen").catch(() => {});
  }
})();
