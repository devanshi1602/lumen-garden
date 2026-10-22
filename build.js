// Inlines all scripts into a single self-contained dist/index.html (ready for GitHub Pages).
const fs = require('fs'), path = require('path');
const src = p => fs.readFileSync(path.join(__dirname, 'src', p), 'utf8');
let html = src('index.html');
const scripts = ['math.js', 'puzzle.js', 'gl.js', 'audio.js', 'game.js'].map(f => `<script>/* ${f} */\n${src(f)}\n</script>`).join('\n');
html = html.replace(/<!--SCRIPTS-->[\s\S]*<!--\/SCRIPTS-->/, scripts);
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), html);
console.log('dist/index.html', (html.length / 1024).toFixed(1) + ' KB');
