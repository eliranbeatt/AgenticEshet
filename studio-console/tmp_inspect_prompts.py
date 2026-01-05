import pathlib
p = pathlib.Path('convex/skills/agentSkills.generated.json')
s = p.read_text(encoding='utf-8')
idx = s.find('"prompt":')
print('idx', idx)
chunk = s[idx:idx+200]
print('chunk (repr):', repr(chunk))
print('contains literal newline characters in chunk?', '\n' in chunk)
print('contains escaped \\n sequence in chunk?', '\\n' in chunk)
