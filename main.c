#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdarg.h>
#include <string.h>
#include <math.h>
#include <assert.h>
#include <limits.h>
#include <time.h>
#include <errno.h>
#include <sys/stat.h>

#include <GL/glew.h>
#include <GLFW/glfw3.h>

#define NK_INCLUDE_FIXED_TYPES
#define NK_INCLUDE_STANDARD_IO
#define NK_INCLUDE_STANDARD_VARARGS
#define NK_INCLUDE_DEFAULT_ALLOCATOR
#define NK_INCLUDE_VERTEX_BUFFER_OUTPUT
#define NK_INCLUDE_FONT_BAKING
#define NK_INCLUDE_DEFAULT_FONT
#include "nuklear.h"
#include "nuklear_glfw_gl3.h"

#define WINDOW_WIDTH 1200
#define WINDOW_HEIGHT 800

#define MAX_VERTEX_BUFFER 512 * 1024
#define MAX_ELEMENT_BUFFER 128 * 1024

#define DB_DIR "db"
#define PROJECTS_FILE DB_DIR "/projects.tsv"
#define TIMES_FILE DB_DIR "/times.tsv"

#define MAX_PROJECTS 128
#define MAX_TIMES 8192
#define MAX_PROJECT_NAME 64
#define MAX_TIMESTAMP 20

struct project {
    int id;
    char name[MAX_PROJECT_NAME];
    char last_modified[MAX_TIMESTAMP];
};

struct time_entry {
    char date[11];
    int project_id;
    int blocks_15m;
};

struct app_state {
    struct project projects[MAX_PROJECTS];
    struct time_entry times[MAX_TIMES];
    int project_count;
    int time_count;
    char new_project_name[MAX_PROJECT_NAME];
    char status[128];
};

static void error_callback(int e, const char *d)
{printf("Error %d: %s\n", e, d);}

static void copy_text(char *dst, size_t dst_size, const char *src)
{
    if (dst_size == 0) {
        return;
    }
    strncpy(dst, src, dst_size - 1);
    dst[dst_size - 1] = '\0';
}

static void get_today(char out[11])
{
    time_t t = time(NULL);
    struct tm tm_now;
    struct tm *now = localtime(&t);
    if (!now) {
        copy_text(out, 11, "1970-01-01");
        return;
    }
    tm_now = *now;
    strftime(out, 11, "%Y-%m-%d", &tm_now);
}

static void get_now_timestamp(char out[MAX_TIMESTAMP])
{
    time_t t = time(NULL);
    struct tm tm_now;
    struct tm *now = localtime(&t);
    if (!now) {
        copy_text(out, MAX_TIMESTAMP, "1970-01-01 00:00:00");
        return;
    }
    tm_now = *now;
    strftime(out, MAX_TIMESTAMP, "%Y-%m-%d %H:%M:%S", &tm_now);
}

static int ensure_db(void)
{
    struct stat st;
    if (stat(DB_DIR, &st) == 0) {
        if (S_ISDIR(st.st_mode)) {
            return 1;
        }
        return 0;
    }
    if (mkdir(DB_DIR, 0755) == 0) {
        return 1;
    }
    return errno == EEXIST;
}

static void trim_newline(char *s)
{
    size_t len = strlen(s);
    while (len > 0 && (s[len - 1] == '\n' || s[len - 1] == '\r')) {
        s[--len] = '\0';
    }
}

static int max_project_id(const struct app_state *state)
{
    int max_id = 0;
    int i;
    for (i = 0; i < state->project_count; i++) {
        if (state->projects[i].id > max_id) {
            max_id = state->projects[i].id;
        }
    }
    return max_id;
}

static int find_project_index_by_id(const struct app_state *state, int project_id)
{
    int i;
    for (i = 0; i < state->project_count; i++) {
        if (state->projects[i].id == project_id) {
            return i;
        }
    }
    return -1;
}

static void save_projects(const struct app_state *state)
{
    FILE *f = fopen(PROJECTS_FILE, "w");
    int i;
    if (!f) {
        return;
    }
    fprintf(f, "id\tname\tlast_modified\n");
    for (i = 0; i < state->project_count; i++) {
        fprintf(
            f,
            "%d\t%s\t%s\n",
            state->projects[i].id,
            state->projects[i].name,
            state->projects[i].last_modified
        );
    }
    fclose(f);
}

static void save_times(const struct app_state *state)
{
    FILE *f = fopen(TIMES_FILE, "w");
    int i;
    if (!f) {
        return;
    }
    fprintf(f, "date\tproject_id\tblocks_15m\n");
    for (i = 0; i < state->time_count; i++) {
        fprintf(
            f,
            "%s\t%d\t%d\n",
            state->times[i].date,
            state->times[i].project_id,
            state->times[i].blocks_15m
        );
    }
    fclose(f);
}

static void load_projects(struct app_state *state)
{
    char line[256];
    FILE *f = fopen(PROJECTS_FILE, "r");
    if (!f) {
        return;
    }

    while (fgets(line, sizeof(line), f)) {
        char *id_str;
        char *name_str;
        char *last_modified_str;
        if (state->project_count >= MAX_PROJECTS) {
            break;
        }
        trim_newline(line);
        if (line[0] == '\0') {
            continue;
        }
        if (strncmp(line, "id\tname", 7) == 0) {
            continue;
        }

        id_str = strtok(line, "\t");
        name_str = strtok(NULL, "\t");
        last_modified_str = strtok(NULL, "");
        if (!id_str || !name_str) {
            continue;
        }
        state->projects[state->project_count].id = atoi(id_str);
        copy_text(state->projects[state->project_count].name, MAX_PROJECT_NAME, name_str);
        if (last_modified_str && last_modified_str[0] != '\0') {
            copy_text(
                state->projects[state->project_count].last_modified,
                MAX_TIMESTAMP,
                last_modified_str
            );
        } else {
            copy_text(
                state->projects[state->project_count].last_modified,
                MAX_TIMESTAMP,
                "never"
            );
        }
        state->project_count++;
    }
    fclose(f);
}

static void load_times(struct app_state *state)
{
    char line[256];
    FILE *f = fopen(TIMES_FILE, "r");
    if (!f) {
        return;
    }

    while (fgets(line, sizeof(line), f)) {
        char *date_str;
        char *project_id_str;
        char *blocks_str;
        if (state->time_count >= MAX_TIMES) {
            break;
        }
        trim_newline(line);
        if (line[0] == '\0') {
            continue;
        }
        if (strncmp(line, "date\tproject_id\tblocks_15m", 26) == 0) {
            continue;
        }

        date_str = strtok(line, "\t");
        project_id_str = strtok(NULL, "\t");
        blocks_str = strtok(NULL, "\t");
        if (!date_str || !project_id_str || !blocks_str) {
            continue;
        }

        copy_text(state->times[state->time_count].date, 11, date_str);
        state->times[state->time_count].project_id = atoi(project_id_str);
        state->times[state->time_count].blocks_15m = atoi(blocks_str);
        state->time_count++;
    }
    fclose(f);
}

static int find_time_entry(
    const struct app_state *state,
    const char *date,
    int project_id
)
{
    int i;
    for (i = 0; i < state->time_count; i++) {
        if (
            state->times[i].project_id == project_id &&
            strcmp(state->times[i].date, date) == 0
        ) {
            return i;
        }
    }
    return -1;
}

static int project_total_blocks(const struct app_state *state, int project_id)
{
    int i;
    int total = 0;
    for (i = 0; i < state->time_count; i++) {
        if (state->times[i].project_id == project_id) {
            total += state->times[i].blocks_15m;
        }
    }
    return total;
}

static int project_today_blocks(const struct app_state *state, int project_id)
{
    int idx;
    char today[11];
    get_today(today);
    idx = find_time_entry(state, today, project_id);
    if (idx < 0) {
        return 0;
    }
    return state->times[idx].blocks_15m;
}

static void add_project(struct app_state *state)
{
    int next_id;
    char now[MAX_TIMESTAMP];
    if (state->project_count >= MAX_PROJECTS) {
        copy_text(state->status, sizeof(state->status), "Project limit reached");
        return;
    }
    if (state->new_project_name[0] == '\0') {
        copy_text(state->status, sizeof(state->status), "Project name is required");
        return;
    }

    next_id = max_project_id(state) + 1;
    state->projects[state->project_count].id = next_id;
    copy_text(
        state->projects[state->project_count].name,
        MAX_PROJECT_NAME,
        state->new_project_name
    );
    get_now_timestamp(now);
    copy_text(
        state->projects[state->project_count].last_modified,
        MAX_TIMESTAMP,
        now
    );
    state->project_count++;
    state->new_project_name[0] = '\0';
    save_projects(state);
    copy_text(state->status, sizeof(state->status), "Project added");
}

static void add_time_blocks(struct app_state *state, int project_id, int delta)
{
    int idx;
    int project_idx;
    char today[11];
    char now[MAX_TIMESTAMP];
    if (state->project_count <= 0) {
        copy_text(state->status, sizeof(state->status), "Add a project first");
        return;
    }

    get_today(today);
    idx = find_time_entry(state, today, project_id);
    if (idx < 0) {
        if (delta < 0) {
            return;
        }
        if (state->time_count >= MAX_TIMES) {
            copy_text(state->status, sizeof(state->status), "Time entry limit reached");
            return;
        }
        idx = state->time_count++;
        copy_text(state->times[idx].date, 11, today);
        state->times[idx].project_id = project_id;
        state->times[idx].blocks_15m = 0;
    }

    state->times[idx].blocks_15m += delta;
    if (state->times[idx].blocks_15m < 0) {
        state->times[idx].blocks_15m = 0;
    }
    project_idx = find_project_index_by_id(state, project_id);
    if (project_idx >= 0) {
        get_now_timestamp(now);
        copy_text(state->projects[project_idx].last_modified, MAX_TIMESTAMP, now);
        save_projects(state);
    }
    save_times(state);
    copy_text(state->status, sizeof(state->status), "Time updated");
}

int main(void)
{
    struct app_state state;
    /* Platform */
    struct nk_glfw glfw = {0};
    static GLFWwindow *win;
    int width = 0, height = 0;
    int fb_width = 0, fb_height = 0;
    struct nk_context *ctx;
    struct nk_font *font = NULL;
    struct nk_font_atlas *atlas;
    struct nk_colorf bg;
    char today[11];
    float xscale = 1.0f;
    float yscale = 1.0f;
    float ui_scale = 1.0f;
    float row_small = 24.0f;
    float row_medium = 28.0f;
    float row_large = 30.0f;
    float row_gap = 10.0f;

    memset(&state, 0, sizeof(state));

    if (!ensure_db()) {
        fprintf(stderr, "Failed to create or access db directory\n");
        return 1;
    }
    load_projects(&state);
    load_times(&state);
    save_projects(&state);
    save_times(&state);

    /* GLFW */
    glfwSetErrorCallback(error_callback);
    if (!glfwInit()) {
        fprintf(stdout, "[GFLW] failed to init!\n");
        exit(1);
    }
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
#ifdef __APPLE__
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);
#endif
    win = glfwCreateWindow(WINDOW_WIDTH, WINDOW_HEIGHT, "Kronik", NULL, NULL);
    glfwMakeContextCurrent(win);
    glfwGetWindowSize(win, &width, &height);
    glfwGetFramebufferSize(win, &fb_width, &fb_height);
    glfwGetWindowContentScale(win, &xscale, &yscale);
    ui_scale = (xscale + yscale) * 0.5f;
    if (ui_scale < 1.0f) {
        ui_scale = 1.0f;
    }
    if (ui_scale > 3.0f) {
        ui_scale = 3.0f;
    }
    row_small = 24.0f * ui_scale;
    row_medium = 28.0f * ui_scale;
    row_large = 30.0f * ui_scale;
    row_gap = 10.0f * ui_scale;

    /* OpenGL */
    glViewport(0, 0, fb_width, fb_height);
    glewExperimental = 1;
    if (glewInit() != GLEW_OK) {
        fprintf(stderr, "Failed to setup GLEW\n");
        exit(1);
    }

    ctx = nk_glfw3_init(&glfw, win, NK_GLFW3_INSTALL_CALLBACKS);
    {
        nk_glfw3_font_stash_begin(&glfw, &atlas);
        font = nk_font_atlas_add_default(atlas, 16.0f * ui_scale, 0);
        nk_glfw3_font_stash_end(&glfw);
    }
    if (font) {
        nk_style_set_font(ctx, &font->handle);
    }

    bg.r = 0.10f, bg.g = 0.18f, bg.b = 0.24f, bg.a = 1.0f;
    while (!glfwWindowShouldClose(win))
    {
        int i;

        /* Input */
        glfwPollEvents();
        nk_glfw3_new_frame(&glfw);
        get_today(today);

        /* GUI */
        if (nk_begin(
            ctx,
            "Kronik",
            nk_rect(0, 0, (float)width, (float)height),
            0
        ))
        {
            nk_layout_row_dynamic(ctx, row_small, 1);
            nk_label(ctx, "Track work in 15-minute blocks.", NK_TEXT_LEFT);
            nk_label(ctx, today, NK_TEXT_LEFT);

            nk_layout_row_dynamic(ctx, row_medium, 1);
            nk_edit_string_zero_terminated(
                ctx,
                NK_EDIT_FIELD,
                state.new_project_name,
                sizeof(state.new_project_name),
                nk_filter_default
            );

            nk_layout_row_dynamic(ctx, row_medium, 2);
            if (nk_button_label(ctx, "Add Project")) {
                add_project(&state);
            }
            nk_spacing(ctx, 1);

            nk_layout_row_dynamic(ctx, row_gap, 1);
            nk_spacing(ctx, 1);

            if (state.project_count <= 0) {
                nk_layout_row_dynamic(ctx, row_small, 1);
                nk_label(ctx, "No projects yet. Add one above.", NK_TEXT_LEFT);
            } else {
                nk_layout_row_dynamic(ctx, row_small, 6);
                nk_label(ctx, "Project", NK_TEXT_LEFT);
                nk_label(ctx, "Today", NK_TEXT_LEFT);
                nk_label(ctx, "Total", NK_TEXT_LEFT);
                nk_label(ctx, "Last Modified", NK_TEXT_LEFT);
                nk_label(ctx, "", NK_TEXT_LEFT);
                nk_label(ctx, "", NK_TEXT_LEFT);

                for (i = 0; i < state.project_count; i++) {
                    char today_text[64];
                    char total_text[64];
                    int today_blocks = project_today_blocks(&state, state.projects[i].id);
                    int total_blocks = project_total_blocks(&state, state.projects[i].id);

                    sprintf(today_text, "%.2f h", today_blocks * 0.25f);
                    sprintf(total_text, "%.2f h", total_blocks * 0.25f);

                    nk_layout_row_dynamic(ctx, row_large, 6);
                    nk_label(ctx, state.projects[i].name, NK_TEXT_LEFT);
                    nk_label(ctx, today_text, NK_TEXT_LEFT);
                    nk_label(ctx, total_text, NK_TEXT_LEFT);
                    nk_label(ctx, state.projects[i].last_modified, NK_TEXT_LEFT);
                    if (nk_button_label(ctx, "-15")) {
                        add_time_blocks(&state, state.projects[i].id, -1);
                    }
                    if (nk_button_label(ctx, "+15")) {
                        add_time_blocks(&state, state.projects[i].id, 1);
                    }
                }
            }

            nk_layout_row_dynamic(ctx, row_medium, 1);
            nk_label(ctx, state.status, NK_TEXT_LEFT);
        }
        nk_end(ctx);

        /* Draw */
        glfwGetWindowSize(win, &width, &height);
        glfwGetFramebufferSize(win, &fb_width, &fb_height);
        glViewport(0, 0, fb_width, fb_height);
        glClear(GL_COLOR_BUFFER_BIT);
        glClearColor(bg.r, bg.g, bg.b, bg.a);
        nk_glfw3_render(&glfw, NK_ANTI_ALIASING_ON, MAX_VERTEX_BUFFER, MAX_ELEMENT_BUFFER);
        glfwSwapBuffers(win);
    }
    nk_glfw3_shutdown(&glfw);
    glfwTerminate();
    return 0;
}
