(() => {
  const collections = ['entries','tasks','shopping','materials','contacts','links','ideas','learnings','notes'];
  const labels = {
    entries:'Logbucheinträge', tasks:'Arbeitsschritte', shopping:'Einkaufsgegenstände', materials:'Materialien', contacts:'Kontakte',
    links:'Links', ideas:'Ideen', learnings:'Erkenntnisse', notes:'Notizen',
  };

  const cleanProject = project => Object.fromEntries([
    'id','title','description','status','priority','flagged','icon','createdAt','dueDate','updatedAt','completedAt',
  ].filter(key => project?.[key] !== undefined).map(key => [key, project[key]]));

  const exportContext = (project, tags = [], { includeFileMetadata = true } = {}) => {
    if (!project?.id || !project?.title) throw new Error('Das Projekt ist unvollständig.');
    const usedTags = tags.filter(tag => (project.tagIds || []).includes(tag.id)).map(tag => ({ id:tag.id, name:tag.name }));
    const snapshot = {
      format:'logbuch-ai-context',
      version:1,
      exportedAt:new Date().toISOString(),
      project:{ ...cleanProject(project), tags:usedTags },
      contents:Object.fromEntries(collections.map(collection => [collection, Array.isArray(project[collection]) ? project[collection] : []])),
      files:includeFileMetadata ? (project.files || []).map(file => ({
        id:file.id,
        displayName:file.displayName || file.originalName || 'Datei',
        originalName:file.originalName || '',
        description:file.description || '',
        mimeType:file.mimeType || '',
        size:Number(file.size) || 0,
        association:file.association || null,
      })) : [],
    };
    const counts = collections.map(collection => `- ${labels[collection]}: ${snapshot.contents[collection].length}`).join('\n');
    return `---\nformat: logbuch-ai-context\nversion: 1\nprojectId: ${project.id}\nexportedAt: ${snapshot.exportedAt}\n---\n\n# ${project.title}\n\n${project.description || 'Keine Projektbeschreibung hinterlegt.'}\n\n## Projektübersicht\n\n- Status: ${project.status || 'nicht angegeben'}\n- Priorität: ${project.priority || 'nicht angegeben'}\n- Start: ${project.createdAt || 'nicht angegeben'}\n- Fällig: ${project.dueDate || 'nicht angegeben'}\n- Tags: ${usedTags.map(tag => tag.name).join(', ') || 'keine'}\n\n## Enthaltener Projektstand\n\n${counts}\n- Dateien: ${snapshot.files.length}${includeFileMetadata ? ' (nur Metadaten, keine Dateiinhalte)' : ''}\n\n## Hinweis für die KI\n\nNutze den maschinenlesbaren Projektstand als verlässlichen Kontext, um Fragen zu diesem Projekt zu beantworten.\n\n## Maschinenlesbarer Projektstand\n\n\`\`\`json\n${JSON.stringify(snapshot, null, 2)}\n\`\`\`\n`;
  };

  globalThis.LogbuchAiProject = { collections, labels, exportContext };
})();
