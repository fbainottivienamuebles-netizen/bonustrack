package com.bonustrack.letras;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.AdvertisingSet;
import android.bluetooth.le.AdvertisingSetCallback;
import android.bluetooth.le.AdvertisingSetParameters;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.os.Build;
import android.os.ParcelUuid;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.Collections;

/**
 * Sincronía por Bluetooth sin conexión: el "puente" transmite el estado del
 * show en avisos BLE (service data, 16 bytes) y los seguidores los escuchan.
 * Como nadie se conecta, no hay límite de equipos escuchando.
 * El formato del dato está en packages/shared/src/sync-protocol.ts.
 */
@CapacitorPlugin(
    name = "BleSync",
    permissions = {
        @Permission(
            alias = "bleNew",
            strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE }
        ),
        @Permission(alias = "bleOld", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
@SuppressLint("MissingPermission")
public class BleSyncPlugin extends Plugin {

    /** UUID de 16 bits propio de la app (0xF1A5). */
    static final ParcelUuid SERVICE = ParcelUuid.fromString("0000f1a5-0000-1000-8000-00805f9b34fb");
    static final byte VERSION = 1;

    private AdvertisingSet advSet;
    private AdvertisingSetCallback advSetCallback;
    private AdvertiseCallback legacyCallback;
    private ScanCallback scanCallback;

    private String alias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? "bleNew" : "bleOld";
    }

    private BluetoothAdapter adapter() {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return bm == null ? null : bm.getAdapter();
    }

    /** null si está todo bien; si no, el motivo (en castellano, se muestra tal cual). */
    private String problem() {
        if (getPermissionState(alias()) != PermissionState.GRANTED) return "Falta el permiso de Bluetooth para la app.";
        BluetoothAdapter a = adapter();
        if (a == null) return "Este equipo no tiene Bluetooth.";
        if (!a.isEnabled()) return "Prendé el Bluetooth del equipo y probá de nuevo.";
        return null;
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (getPermissionState(alias()) == PermissionState.GRANTED) {
            accessCallback(call);
            return;
        }
        requestPermissionForAlias(alias(), call, "accessCallback");
    }

    @PermissionCallback
    private void accessCallback(PluginCall call) {
        String p = problem();
        if (p != null) call.reject(p);
        else call.resolve();
    }

    // ---------- Transmitir (puente) ----------

    private AdvertiseData data(byte[] payload) {
        return new AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addServiceData(SERVICE, payload)
            .build();
    }

    @PluginMethod
    public void advertise(PluginCall call) {
        String p = problem();
        if (p != null) {
            call.reject(p);
            return;
        }
        byte[] payload;
        try {
            payload = Base64.decode(call.getString("payload", ""), Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Dato inválido");
            return;
        }
        BluetoothLeAdvertiser adv = adapter().getBluetoothLeAdvertiser();
        if (adv == null) {
            call.reject("Este equipo no puede transmitir por Bluetooth (no soporta avisos BLE).");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Android 8+: un "advertising set" permite cambiar el dato sin cortar.
            if (advSet != null) {
                advSet.setAdvertisingData(data(payload));
                call.resolve();
                return;
            }
            if (advSetCallback == null) {
                AdvertisingSetParameters params = new AdvertisingSetParameters.Builder()
                    .setLegacyMode(true)
                    .setConnectable(false)
                    .setScannable(false)
                    .setInterval(AdvertisingSetParameters.INTERVAL_LOW)
                    .setTxPowerLevel(AdvertisingSetParameters.TX_POWER_HIGH)
                    .build();
                advSetCallback = new AdvertisingSetCallback() {
                    @Override
                    public void onAdvertisingSetStarted(AdvertisingSet set, int txPower, int status) {
                        if (status == AdvertisingSetCallback.ADVERTISE_SUCCESS) advSet = set;
                        else advSetCallback = null;
                    }

                    @Override
                    public void onAdvertisingSetStopped(AdvertisingSet set) {
                        advSet = null;
                    }
                };
                adv.startAdvertisingSet(params, data(payload), null, null, null, advSetCallback);
            }
            call.resolve();
            return;
        }

        // Android 7: hay que reiniciar el aviso para cambiar el dato.
        if (legacyCallback != null) adv.stopAdvertising(legacyCallback);
        AdvertiseSettings settings = new AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(false)
            .setTimeout(0)
            .build();
        legacyCallback = new AdvertiseCallback() {};
        adv.startAdvertising(settings, data(payload), legacyCallback);
        call.resolve();
    }

    private void stopAdvertisingInternal() {
        BluetoothAdapter a = adapter();
        BluetoothLeAdvertiser adv = a == null ? null : a.getBluetoothLeAdvertiser();
        try {
            if (adv != null && advSetCallback != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                adv.stopAdvertisingSet(advSetCallback);
            }
            if (adv != null && legacyCallback != null) adv.stopAdvertising(legacyCallback);
        } catch (SecurityException | IllegalStateException ignored) {
            // Bluetooth apagado o sin permiso: ya no transmite.
        }
        advSet = null;
        advSetCallback = null;
        legacyCallback = null;
    }

    @PluginMethod
    public void stopAdvertising(PluginCall call) {
        stopAdvertisingInternal();
        call.resolve();
    }

    // ---------- Escuchar (seguidor) ----------

    @PluginMethod
    public void startScan(PluginCall call) {
        String p = problem();
        if (p != null) {
            call.reject(p);
            return;
        }
        BluetoothLeScanner scanner = adapter().getBluetoothLeScanner();
        if (scanner == null) {
            call.reject("No se pudo usar el Bluetooth del equipo.");
            return;
        }
        if (scanCallback != null) {
            call.resolve();
            return;
        }
        ScanFilter filter = new ScanFilter.Builder()
            .setServiceData(SERVICE, new byte[] { VERSION }, new byte[] { (byte) 0xFF })
            .build();
        ScanSettings settings = new ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
            .setReportDelay(0)
            .build();
        scanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                ScanRecord rec = result.getScanRecord();
                byte[] d = rec == null ? null : rec.getServiceData(SERVICE);
                if (d == null) return;
                JSObject ev = new JSObject();
                ev.put("payload", Base64.encodeToString(d, Base64.NO_WRAP));
                ev.put("rssi", result.getRssi());
                notifyListeners("packet", ev);
            }

            @Override
            public void onScanFailed(int errorCode) {
                scanCallback = null;
            }
        };
        scanner.startScan(Collections.singletonList(filter), settings, scanCallback);
        call.resolve();
    }

    private void stopScanInternal() {
        BluetoothAdapter a = adapter();
        BluetoothLeScanner scanner = a == null ? null : a.getBluetoothLeScanner();
        try {
            if (scanner != null && scanCallback != null) scanner.stopScan(scanCallback);
        } catch (SecurityException | IllegalStateException ignored) {
            // idem
        }
        scanCallback = null;
    }

    @PluginMethod
    public void stopScan(PluginCall call) {
        stopScanInternal();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        stopAdvertisingInternal();
        stopScanInternal();
    }
}
