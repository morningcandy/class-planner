/* theme-switch.js — 오른쪽 아래 디자인 전환 버튼
 *
 * 고른 값은 localStorage 에만 저장한다(기기별 설정, 시트에 올리지 않는다).
 * 첫 페인트 전 적용은 index.html <head> 의 인라인 스크립트가 담당하고,
 * 이 파일은 버튼과 메뉴 동작만 맡는다.
 */
(function () {
  'use strict';

  var KEY = 'classPlanner.theme.v1';
  var fab = document.getElementById('themeFab');
  var menu = document.getElementById('themeMenu');
  var btn = document.getElementById('themeBtn');
  if (!fab || !menu || !btn) return;

  function current() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  function mark() {
    var now = current();
    Array.prototype.forEach.call(menu.querySelectorAll('button[data-theme-set]'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-theme-set') === now);
    });
  }

  function apply(theme) {
    if (theme === 'light') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    mark();
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    menu.classList.toggle('open');
    mark();
  });

  menu.addEventListener('click', function (e) {
    var target = e.target.closest('button[data-theme-set]');
    if (!target) return;
    apply(target.getAttribute('data-theme-set'));
    menu.classList.remove('open');
  });

  document.addEventListener('click', function (e) {
    if (!fab.contains(e.target)) menu.classList.remove('open');
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') menu.classList.remove('open');
  });

  mark();
})();
