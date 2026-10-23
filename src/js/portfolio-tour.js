// Optional portfolio entry. The normal workspace and any saved drawing are untouched.
if (new URLSearchParams(location.search).get('tour') === '1') {
  const guide = document.createElement('aside');
  guide.className = 'portfolio-tour';
  guide.setAttribute('aria-label', 'Explore TorusDraw');
  guide.innerHTML = '<div class="portfolio-tour-heading"><strong>One drawing, two views.</strong><button type="button" aria-label="Dismiss introduction">×</button></div><ol><li>Draw a line across a cell edge. It repeats in the neighboring cell.</li><li>Open <button type="button" data-tour="3d">3D preview</button> to see the same drawing on a surface.</li><li>Open <button type="button" data-tour="surface">Surface</button> to explore different edge connections.</li></ol><a href="https://villewedenberg.com/work/torusdraw/">About this university commission ↗</a>';
  document.querySelector('main').appendChild(guide);
  guide.querySelector('[aria-label="Dismiss introduction"]').addEventListener('click', () => {
    document.getElementById('helpButton').focus();
    guide.remove();
  });
  guide.querySelector('[data-tour="3d"]').addEventListener('click', () => document.getElementById('preview3dButton').click());
  guide.querySelector('[data-tour="surface"]').addEventListener('click', () => document.getElementById('surfaceButton').click());
}
