package com.scottmttmn.mathtutor;

import java.util.function.BooleanSupplier;

/** Main-thread ownership of transient fast refresh; pen contact always takes priority. */
final class FastRefreshController {
    private final BooleanSupplier enter;
    private final Runnable leave;
    private volatile boolean active;
    private boolean writing;

    FastRefreshController(BooleanSupplier enter, Runnable leave) {
        this.enter = enter;
        this.leave = leave;
    }

    boolean begin() {
        if (!active && !writing) active = enter.getAsBoolean();
        return active;
    }

    void end() {
        if (!active) return;
        active = false;
        leave.run();
    }

    void beginStroke() {
        writing = true;
        end();
    }

    void endStroke() {
        writing = false;
    }

    void reset() {
        end();
        writing = false;
    }

    boolean isActive() {
        return active;
    }
}
