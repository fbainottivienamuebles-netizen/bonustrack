# Show en grupo: director por WiFi local

Una notebook es el **director**: ahí se da play, pausa y siguiente tema. Los
celulares, las tablets y los monitores de las cantantes siguen lo que marca,
**sin internet** (solo hace falta un router WiFi, aunque no tenga internet).

```
 Notebook (director) ──HDMI──► Monitor(es) de las cantantes
        │
     Router WiFi ──► celulares y tablets (navegador o app)
                          │
                    Android "puente" ──Bluetooth──► otros Android con la app
```

## Antes del show (con internet)

1. En la notebook, doble click en **`Director.bat`** (en la carpeta del proyecto).
   La primera vez instala lo necesario y tarda unos minutos.
2. Se abre el navegador en `http://localhost:8787`. Ahí, **Buscar setlists en
   el panel** y **Descargar** el setlist del show.
3. Si Windows pregunta por el **Firewall**, tocá **Permitir** (red privada). Si
   no, los celulares no van a poder conectarse.

## En el show

1. Prendé el router y conectá la notebook a ese WiFi (o por cable).
2. Doble click en `Director.bat` y no cierres la ventana negra.
3. **Celulares y tablets**: conectados al mismo WiFi, escaneen el código QR que
   muestra la notebook (o escriban la dirección, por ejemplo `192.168.0.10:8787`).
   Se abre directo la letra siguiendo al director.
4. **Monitores**: conectalos a la notebook por HDMI en modo **Extender** (tecla
   Windows + P). En la notebook, tocá **Abrir pantalla de escenario**: se abre
   en el otro monitor (en Chrome o Edge puede pedir permiso para "administrar
   ventanas"; aceptalo). Hacé click en esa ventana para pantalla completa. Para
   un segundo monitor, tocá el botón otra vez. Si los dos monitores muestran lo
   mismo (modo Duplicar o splitter HDMI), alcanza con una ventana.
5. Abrí el setlist en la notebook y manejá el show como siempre (también con la
   pedalera o el teclado: espacio = play/pausa, flechas = temas).

### En cada pantalla que sigue

- **A− / A+**: tamaño de la letra.
- **Adelanto**: si la línea se marca tarde (o temprano), corregilo de a 0,05 s.
  Lo recuerda cada equipo.
- Si se corta el WiFi, la letra **sigue avanzando sola** y se vuelve a
  sincronizar cuando vuelve la conexión.
- Si se recarga la página del director, ofrece **Retomar** donde estaba.

## Bluetooth (solo Android con la app instalada)

Sirve para equipos que no se pueden conectar al WiFi.

1. Todos los Android tienen que tener la **app instalada (APK)** y el setlist
   **descargado** desde el panel (la letra no viaja por Bluetooth).
2. Un Android conectado al WiFi del director (Inicio → *Seguir por WiFi*) prende
   **Puente BT**. Ese equipo hace de puente.
3. Los demás Android: Inicio → **Seguir por Bluetooth**. Pide permiso de
   Bluetooth (en Android 11 o anterior, además hay que tener la ubicación
   prendida).

El alcance es de unos 10 a 20 metros y no tiene límite de equipos.

## Para tener en cuenta

- Los celulares que siguen por WiFi abren la app con `http://` (sin candado).
  Ahí algunos navegadores no dejan bloquear el apagado de pantalla: la app usa
  un truco de respaldo, pero conviene subir el tiempo de apagado de pantalla
  del celular.
- iPhone y iPad funcionan por WiFi (navegador). Bluetooth no está disponible en
  iPhone.
