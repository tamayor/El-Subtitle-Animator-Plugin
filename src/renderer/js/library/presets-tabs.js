// Texts switch (Presets / Library / Create): one copy sits at the top of the Use tab's presets section and of the
// Library and Create views; setTab (js/core/bootstrap.js) lights the matching button in every copy.
document.querySelectorAll('.texts-tabs > .presets-tab[data-tx]').forEach(b => {
    b.addEventListener('click', () => setTab({ presets: 'apply', library: 'library', create: 'create' }[b.dataset.tx] || 'apply'));
});
