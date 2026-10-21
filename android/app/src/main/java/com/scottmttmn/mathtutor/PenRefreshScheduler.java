package com.scottmttmn.mathtutor;

import java.util.function.Consumer;

/** Coalesces page updates until the pen has been up for a quiet interval. */
final class PenRefreshScheduler {
    private final Consumer<Runnable> schedule;
    private final Consumer<Runnable> remove;
    private final Runnable refresh;
    private boolean writing;
    private boolean requested;
    private Runnable scheduled;

    PenRefreshScheduler(Consumer<Runnable> schedule, Consumer<Runnable> remove, Runnable refresh) {
        this.schedule = schedule;
        this.remove = remove;
        this.refresh = refresh;
    }

    synchronized void request() {
        requested = true;
        scheduleIfIdle();
    }

    synchronized void beginStroke() {
        writing = true;
        unschedule();
    }

    synchronized void endStroke() {
        writing = false;
        scheduleIfIdle();
    }

    synchronized void cancel() {
        requested = false;
        writing = false;
        unschedule();
    }

    private void unschedule() {
        if (scheduled != null) remove.accept(scheduled);
        scheduled = null;
    }

    private void scheduleIfIdle() {
        unschedule();
        if (writing || !requested) return;
        scheduled = new Runnable() {
            @Override
            public void run() {
                synchronized (PenRefreshScheduler.this) {
                    // A cancelled callback may already have been dequeued when the pen came down.
                    if (scheduled != this || writing || !requested) return;
                    scheduled = null;
                    requested = false;
                    refresh.run();
                }
            }
        };
        schedule.accept(scheduled);
    }
}
