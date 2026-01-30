# Funcionalidad: Recordar Datos de Login

## Descripción

Los usuarios ahora pueden marcar un checkbox "Recordar mis datos" en la página de login para que el sistema guarde automáticamente su usuario/DNI en el navegador, facilitando inicios de sesión posteriores.

## Características

### 1. **Checkbox "Recordar mis datos"**
   - Ubicado bajo el campo de contraseña
   - Estilizado para coincidir con la interfaz actual
   - Disponible tanto en web como en la aplicación nativa

### 2. **Guardado en localStorage**
   - Los datos se guardan en `localStorage.savedUsername`
   - **Seguridad**: Solo se guarda el usuario/DNI, NUNCA la contraseña
   - Los datos persisten entre sesiones de navegador

### 3. **Comportamiento**

#### Al cargar la página de login:
- Si existe `savedUsername` en localStorage:
  - Se rellena automáticamente en el campo "DNI / Tienda"
  - El checkbox se marca automáticamente
  - El cursor pasa al campo de contraseña para entrar rápido

#### Cuando marca el checkbox:
- Si hay texto en el campo de usuario, se guarda inmediatamente
- Si lo desmarca, se elimina el dato guardado

#### Mientras escribe en el campo de usuario:
- Si el checkbox está marcado, se actualiza el guardado en tiempo real
- Si está desmarcado, no guarda nada

#### Al hacer login:
- Si el checkbox está marcado y el login es exitoso:
  - Se confirma que el usuario se guardó en localStorage
- Si lo desmarca antes de hacer login:
  - Se elimina cualquier dato guardado previo

### 4. **Integración con Biometría**
   - Los datos de biometría se guardan por separado (si está habilitado)
   - El checkbox "Recordar datos" es independiente de la autenticación biométrica

## Implementación Técnica

### Cambios en `public/index.html`:

1. **Nuevo elemento HTML**:
```html
<div class="form-group" id="rememberMeContainer" style="margin-top: var(--spacing-md);">
  <label style="display:flex; align-items:center; gap: var(--spacing-sm); margin-bottom: 0; cursor: pointer;">
    <input type="checkbox" id="rememberMe" style="cursor: pointer;" />
    <span style="font-size: 0.875rem; color: var(--text-secondary);">Recordar mis datos</span>
  </label>
</div>
```

2. **JavaScript - Carga inicial**:
```javascript
window.addEventListener('DOMContentLoaded', () => {
  const savedUsername = localStorage.getItem('savedUsername');
  if (savedUsername) {
    document.getElementById('username').value = savedUsername;
    document.getElementById('rememberMe').checked = true;
    document.getElementById('password').focus();
  }
});
```

3. **JavaScript - Escuchar cambios del checkbox**:
```javascript
document.getElementById('rememberMe').addEventListener('change', (e) => {
  if (e.target.checked) {
    const username = document.getElementById('username').value.trim();
    if (username) {
      localStorage.setItem('savedUsername', username);
    }
  } else {
    localStorage.removeItem('savedUsername');
  }
});
```

4. **JavaScript - Actualización en tiempo real**:
```javascript
document.getElementById('username').addEventListener('input', (e) => {
  if (document.getElementById('rememberMe').checked) {
    localStorage.setItem('savedUsername', e.target.value.trim());
  }
});
```

5. **JavaScript - Al hacer login**:
```javascript
const rememberMe = document.getElementById('rememberMe').checked;
if (rememberMe) {
  localStorage.setItem('savedUsername', username.trim());
} else {
  localStorage.removeItem('savedUsername');
}
```

## Casos de Uso

### Caso 1: Primer login con "Recordar"
1. Usuario ingresa DNI: `12345678`
2. Marca checkbox "Recordar mis datos"
3. Ingresa contraseña y hace login
4. Dato se guarda en localStorage

### Caso 2: Siguiente visita
1. Página se carga y automáticamente rellena `12345678`
2. Checkbox ya está marcado
3. Usuario solo ingresa contraseña (UX mejorada)

### Caso 3: Desmarcar para limpiar
1. Usuario ve que está marcado el checkbox
2. Lo desmarca
3. Dato se elimina inmediatamente de localStorage

### Caso 4: Cambiar usuario en otro dispositivo
1. En otro dispositivo, usuario marca "Recordar"
2. Se guarda el nuevo usuario/DNI (local a ese navegador)
3. Cada dispositivo tiene sus propios datos guardados

## Seguridad

- ✅ **No se almacena contraseña**: Solo el usuario/DNI público
- ✅ **localStorage es local**: No se envía a servidores
- ✅ **User-controlled**: El usuario decide marcarlo o no
- ✅ **Fácil de limpiar**: Desmarcar o limpiar localStorage del navegador
- ✅ **Compatible con biometría**: Funcionan de forma independiente

## Navegadores Soportados

- ✅ Chrome / Chromium
- ✅ Firefox
- ✅ Safari
- ✅ Edge
- ✅ Aplicación nativa (Capacitor)

---

**Fecha de implementación**: 2026-01-30  
**Archivo modificado**: public/index.html
