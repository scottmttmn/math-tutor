package com.scottmttmn.mathtutor;

import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/** Main-thread ownership of transient fast refresh; pen contact always takes priority. */
final class FastRefreshController {
    private final BooleanSupplier enter;
    private final Consumer<Boolean> leave;
    private volatile boolean active;
    private boolean writing;

    FastRefreshController(BooleanSupplier enter, Consumer<Boolean> leave) {
        this.enter = enter;
        this.leave = leave;
    }

    boolean begin() {
        if (!active && !writing) active = enter.getAsBoolean();
        return active;
    }

    void end(boolean clean) {
        if (!active) return;
        active = false;
        leave.accept(clean);
    }

    void beginStroke() {
        writing = true;
        end(false);
    }

    void endStroke() {
        writing = false;
    }

    void reset() {
        end(false);
        writing = false;
    }

    boolean isActive() {
        return active;
    }
}
