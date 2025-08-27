# 🔒 Guía de Seguridad - Monkey Pic

## Archivos Sensibles (NUNCA commitear)

### Backend (.env)
```bash
cp backend/.env.example backend/.env
# Luego editar backend/.env con tus credenciales reales
```

**Variables requeridas:**
- `FIREBASE_API_KEY`
- `FIREBASE_PROJECT_ID` 
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_CLIENT_ID`

### Frontend (firebase-config.json)
```bash
cp frontend/public/firebase-config.json.example frontend/public/firebase-config.json
# Luego editar frontend/public/firebase-config.json con tu config de Firebase
```

## ✅ Verificaciones de Seguridad

### Antes de cada commit:
```bash
# Verificar que archivos sensibles NO están en el índice
git status | grep -E "\.env|firebase-config\.json|\.key|\.pem"

# Si aparece algo, ejecutar:
git reset HEAD archivo-sensible.ext
```

### Verificar .gitignore funciona:
```bash
git check-ignore backend/.env frontend/public/firebase-config.json
# Debe mostrar ambos archivos (están siendo ignorados)
```

## 🚨 Si accidentally commiteas credenciales:

1. **Cambiar TODAS las credenciales inmediatamente**
2. Revocar tokens/keys en Firebase Console
3. Generar nuevas credenciales
4. Limpiar historial de Git si es necesario

## 📋 Checklist de Seguridad

- [ ] `.env` con credenciales reales NO está en Git
- [ ] `firebase-config.json` con keys reales NO está en Git  
- [ ] Solo archivos `.example` están versionados
- [ ] `.gitignore` incluye patrones de seguridad
- [ ] Variables de entorno se cargan en runtime
- [ ] No hay hardcoded secrets en el código
