/**
 * Language Detector Module
 * Automatically detects programming language from file extensions
 */

const LANGUAGE_MAP = {
  '.js': 'javascript',
  '.jsx': 'javascript', 
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rb': 'ruby',
  '.php': 'php',
  '.cpp': 'cpp',
  '.c': 'c',
  '.cs': 'csharp',
  '.rs': 'rust'
};

export function detectLanguage(files) {
  const counts = {};
  
  for (const file of files) {
    const ext = file.filename.substring(file.filename.lastIndexOf('.'));
    const lang = LANGUAGE_MAP[ext];
    if (lang) {
      counts[lang] = (counts[lang] || 0) + 1;
    }
  }
  
  let maxLang = 'unknown';
  let maxCount = 0;
  
  for (const [lang, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      maxLang = lang;
    }
  }
  
  return maxLang;
}

export function isSupported(language) {
  return language !== 'unknown';
}
