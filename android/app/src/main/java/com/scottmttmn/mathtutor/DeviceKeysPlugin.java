package com.scottmttmn.mathtutor;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.List;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The API keys pasted into Settings → Tutor (src/lib/deviceKeys.ts). Each is encrypted with an AES
 * key that never leaves the Android Keystore and stored in device_keys.xml, which the backup rules
 * (res/xml/backup_rules.xml, data_extraction_rules.xml) leave out of Android's backups.
 */
@CapacitorPlugin(name = "DeviceKeys")
public class DeviceKeysPlugin extends Plugin {

    private static final String PREFS = "device_keys";
    private static final String KEY_ALIAS = "math-tutor-device-keys";
    // The three API keys, and "chatgpt": the Sign in with ChatGPT connection (src/lib/chatgptDevice.ts).
    private static final List<String> NAMES = Arrays.asList("anthropic", "gemini", "openai", "chatgpt");

    @PluginMethod
    public void get(PluginCall call) {
        String name = name(call);
        if (name == null) return;
        JSObject result = new JSObject();
        String stored = prefs().getString(name, null);
        if (stored != null) {
            try {
                result.put("value", decrypt(stored));
            } catch (Exception e) {
                // Unreadable (the Keystore key is gone, e.g. after a restore onto another device): ask for it again.
                prefs().edit().remove(name).apply();
            }
        }
        call.resolve(result);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String name = name(call);
        if (name == null) return;
        String value = call.getString("value");
        if (value == null || value.isEmpty()) {
            call.reject("No key given");
            return;
        }
        try {
            prefs().edit().putString(name, encrypt(value)).commit();
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not save the key", e);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String name = name(call);
        if (name == null) return;
        prefs().edit().remove(name).commit();
        call.resolve();
    }

    private String name(PluginCall call) {
        String name = call.getString("name");
        if (name == null || !NAMES.contains(name)) {
            call.reject("Unknown key");
            return null;
        }
        return name;
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey secretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }

    /** iv:ciphertext, each Base64. */
    private String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, secretKey());
        byte[] sealed = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(sealed, Base64.NO_WRAP);
    }

    private String decrypt(String stored) throws Exception {
        String[] parts = stored.split(":", 2);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
}
