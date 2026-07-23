const fs = require('fs');
const files = ['src/components/Dashboard.tsx', 'src/components/ChatWidget.tsx'];
files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  content = content.replace(/\\`/g, '`').replace(/\\\$/g, '$');
  fs.writeFileSync(f, content);
});
console.log("Done");
